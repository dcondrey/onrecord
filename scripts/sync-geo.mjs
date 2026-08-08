#!/usr/bin/env node
// Rebuilds the DISTRICTS boundary polygons in web/index.html from real GIS
// sources: City of San Diego's Community Planning Area layer (ArcGIS Open
// Data) for CPAs, and SANDAG's regional municipal boundary layer for the
// independent cities. Both are fetched (or read from .gis-cache/ if already
// downloaded) as GeoJSON in WGS84, combined into one topojson topology so
// shared borders between adjacent districts simplify to the SAME arc instead
// of drifting apart into slivers, simplified, then reduced to the single
// dominant ring per district (matching the existing single-ring poly format)
// and spliced into web/index.html between marker comments — same idiom as
// scripts/sync-web-data.mjs.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { topology } from 'topojson-server';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import { feature } from 'topojson-client';

const CPA_URL = 'https://services.arcgis.com/uEH09Hfm70zI2ZxR/arcgis/rest/services/City_of_San_Diego_Community_Planning_Areas/FeatureServer/0/query?where=1=1&outFields=CPCODE,CPNAME&f=geojson&outSR=4326';
const CITY_URL = 'https://services1.arcgis.com/eGSDp8lpKe5izqVc/arcgis/rest/services/Sandag_Municipal_Boundaries/FeatureServer/0/query?where=1=1&outFields=Name,CODE&f=geojson&outSR=4326';

// existing DISTRICTS key -> source layer + name. Verified against each
// source polygon's bounding box before mapping (see commit message);
// "spring-valley" has no match in either dataset (unincorporated CDP, not
// a CPA) and keeps its hand-drawn shape.
const SOURCE = {
  'la-jolla': { cpa: 'LA JOLLA' },
  'pacific-beach': { cpa: 'PACIFIC BEACH' },
  'mission-beach': { cpa: 'MISSION BEACH' },
  'clairemont-mesa': { cpa: 'CLAIREMONT MESA' },
  'kearny-mesa': { cpa: 'KEARNY MESA' },
  'university-city': { cpa: 'UNIVERSITY' },
  'military-facilities': { cpa: 'MILITARY FACILITIES' },
  'east-elliott': { cpa: 'EAST ELLIOTT' },
  'tierrasanta': { cpa: 'TIERRASANTA' },
  'navajo': { cpa: 'NAVAJO' },
  'serra-mesa': { cpa: 'SERRA MESA' },
  'linda-vista': { cpa: 'LINDA VISTA' },
  'ocean-beach': { cpa: 'OCEAN BEACH' },
  'point-loma': { cpa: 'PENINSULA' },
  'mission-valley': { cpa: 'MISSION VALLEY' },
  'mission-bay-park': { cpa: 'MISSION BAY PARK' },
  'uptown': { cpa: 'UPTOWN' },
  'north-park': { cpa: 'GREATER NORTH PARK' },
  'balboa-park': { cpa: 'BALBOA PARK' },
  'greater-golden-hill': { cpa: 'GREATER GOLDEN HILL' },
  'downtown': { cpa: 'DOWNTOWN' },
  'barrio-logan': { cpa: 'BARRIO LOGAN' },
  'college-area': { cpa: 'COLLEGE AREA' },
  'kensington-talmadge': { cpa: 'MID-CITY:KENSINGTON-TALMADGE' },
  'normal-heights': { cpa: 'MID-CITY:NORMAL HEIGHTS' },
  'eastern-area': { cpa: 'MID-CITY:EASTERN AREA' },
  'old-town': { cpa: 'OLD TOWN SAN DIEGO' },
  'midway': { cpa: 'MIDWAY-PACIFIC HIGHWAY' },
  'city-heights': { cpa: 'MID-CITY:CITY HEIGHTS' },
  'encanto': { cpa: 'ENCANTO NEIGHBORHOODS,SOUTHEASTERN' },
  'skyline-paradise-hills': { cpa: 'SKYLINE-PARADISE HILLS' },
  'southeastern': { cpa: 'SOUTHEASTERN SAN DIEGO,SOUTHEASTERN' },
  'otay-mesa-nestor': { cpa: 'OTAY MESA-NESTOR' },
  'otay-mesa': { cpa: 'OTAY MESA' },
  'san-ysidro': { cpa: 'SAN YSIDRO' },
  'tijuana-river-valley': { cpa: 'TIJUANA RIVER VALLEY' },
  'coronado': { city: 'CORONADO' },
  'national-city': { city: 'NATIONAL CITY' },
  'chula-vista': { city: 'CHULA VISTA' },
  'imperial-beach': { city: 'IMPERIAL BEACH' },
  'la-mesa': { city: 'LA MESA' },
  'el-cajon': { city: 'EL CAJON' },
  'lemon-grove': { city: 'LEMON GROVE' },
  'santee': { city: 'SANTEE' },
};

const QUANTILE = process.env.SYNC_GEO_QUANTILE ? +process.env.SYNC_GEO_QUANTILE : 0.1;

async function fetchCached(url, cacheFile) {
  await mkdir('.gis-cache', { recursive: true });
  const path = `.gis-cache/${cacheFile}`;
  if (existsSync(path)) return JSON.parse(await readFile(path, 'utf8'));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
  const json = await res.json();
  await writeFile(path, JSON.stringify(json));
  return json;
}

function mergeGeometry(features) {
  if (features.length === 1) return features[0].geometry;
  // Combine multiple polygon parts (annexation-history rows / exclaves)
  // into one MultiPolygon so the topology build sees all rings.
  const polys = [];
  for (const f of features) {
    if (f.geometry.type === 'Polygon') polys.push(f.geometry.coordinates);
    else if (f.geometry.type === 'MultiPolygon') polys.push(...f.geometry.coordinates);
  }
  return { type: 'MultiPolygon', coordinates: polys };
}

function ringArea(ring) {
  // Shoelace formula, magnitude only (units are deg^2, fine for comparison).
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(a / 2);
}

function dominantRing(geometry) {
  const rings = geometry.type === 'Polygon' ? [geometry.coordinates[0]]
    : geometry.coordinates.map(poly => poly[0]);
  return rings.reduce((best, r) => ringArea(r) > ringArea(best) ? r : best, rings[0]);
}

console.log('fetching CPA layer...');
const cpaData = await fetchCached(CPA_URL, 'cpa.geojson');
console.log('fetching municipal boundary layer...');
const cityData = await fetchCached(CITY_URL, 'cities.geojson');

const objects = {};
for (const [key, src] of Object.entries(SOURCE)) {
  const pool = src.cpa
    ? cpaData.features.filter(f => f.properties.CPNAME === src.cpa)
    : cityData.features.filter(f => f.properties.Name === src.city);
  if (pool.length === 0) throw new Error(`no source features for ${key} (${JSON.stringify(src)})`);
  objects[key] = { type: 'Feature', properties: {}, geometry: mergeGeometry(pool) };
}

console.log('building shared topology...');
let topo = topology(objects);
topo = presimplify(topo);
const weight = quantile(topo, QUANTILE);
topo = simplify(topo, weight);

const result = {};
let totalPoints = 0;
for (const key of Object.keys(objects)) {
  const geo = feature(topo, topo.objects[key]);
  const ring = dominantRing(geo.geometry);
  // Drop the closing duplicate point (existing poly format is an open ring;
  // path() closes it with "Z").
  const pts = ring.slice(0, -1).map(([lon, lat]) => [+lon.toFixed(6), +lat.toFixed(6)]);
  result[key] = pts;
  totalPoints += pts.length;
}
console.log(`${Object.keys(result).length} districts, ${totalPoints} points, quantile=${QUANTILE}`);

let html = await readFile('web/index.html', 'utf8');
const pattern = /const DISTRICTS = \{[\s\S]*?\n\};/;
if (!pattern.test(html)) throw new Error('DISTRICTS block not found');
const districtsSrc = await readFile('web/index.html', 'utf8');
const blockMatch = districtsSrc.match(pattern)[0];

// Replace only the poly:[...] payload for each mapped key, leaving label/
// noLabel and any keys with no GIS source (spring-valley) untouched.
let newBlock = blockMatch;
for (const [key, pts] of Object.entries(result)) {
  const polyStr = `poly:[${pts.map(p => `[${p[0]},${p[1]}]`).join(',')}]`;
  const re = new RegExp(`("${key}":\\{label:"[^"]*",\\s*)poly:\\[(?:\\[[-\\d.]+,[-\\d.]+\\],?)+\\]`);
  if (!re.test(newBlock)) throw new Error(`could not locate poly field for ${key}`);
  newBlock = newBlock.replace(re, `$1${polyStr}`);
}

html = html.replace(pattern, newBlock);
await writeFile('web/index.html', html);
console.log('web/index.html updated');
