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
const COASTLINE_QUERY = '[out:json][timeout:25];way["natural"="coastline"](32.53,-117.30,32.95,-117.20);out geom;';
const COASTLINE_URL = 'https://overpass-api.de/api/interpreter';
// North edge of the map's projection. Raised from the previous 32.88, which
// hard-clipped University City and the coastline right at the city limit
// with no room to show Torrey Pines. VBH (viewBox height) derives from this,
// so raising it changes the whole map's default framing, not just the top
// edge — see OPEN item 3 in the map polish plan.
const LAT_TOP = 32.93;

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

// 0.02 keeps real street-following contours (~2000 total vertices across 44
// districts, ~15% larger file) without the ~90k-vertex parcel-line density
// of the raw source data — see commit message for the quantile sweep.
const QUANTILE = process.env.SYNC_GEO_QUANTILE ? +process.env.SYNC_GEO_QUANTILE : 0.02;

async function fetchCached(url, cacheFile, options) {
  await mkdir('.gis-cache', { recursive: true });
  const path = `.gis-cache/${cacheFile}`;
  if (existsSync(path)) return JSON.parse(await readFile(path, 'utf8'));
  const res = await fetch(url, options);
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
const districtsPattern = /const DISTRICTS = \{[\s\S]*?\n\};/;
if (!districtsPattern.test(html)) throw new Error('DISTRICTS block not found');
let districtsBlock = html.match(districtsPattern)[0];

// Replace only the poly:[...] payload for each mapped key, leaving label/
// noLabel and any keys with no GIS source (spring-valley) untouched.
for (const [key, pts] of Object.entries(result)) {
  const polyStr = `poly:[${pts.map(p => `[${p[0]},${p[1]}]`).join(',')}]`;
  const re = new RegExp(`("${key}":\\{label:"[^"]*",\\s*)poly:\\[(?:\\[[-\\d.]+,[-\\d.]+\\],?)+\\]`);
  if (!re.test(districtsBlock)) throw new Error(`could not locate poly field for ${key}`);
  districtsBlock = districtsBlock.replace(re, `$1${polyStr}`);
}
html = html.replace(districtsPattern, districtsBlock);

console.log('fetching coastline...');
const coastData = await fetchCached(COASTLINE_URL, 'coastline.json', { method: 'POST', body: `data=${encodeURIComponent(COASTLINE_QUERY)}` });
const newCoast = buildCoastline(coastData, html);

const coastPattern = /const COAST = \[[\s\S]*?\[-116\.60,32\.5343\],\[-116\.60,32\.95\],\[-117\.29,32\.95\]\];/;
if (!coastPattern.test(html)) throw new Error('COAST array not found');
html = html.replace(coastPattern, `const COAST = [${newCoast.map(p => `[${p[0]},${p[1]}]`).join(',')}];`);

const latTopPattern = /const LON0 = -117\.32, LON1 = -116\.82, LAT_TOP = [\d.]+;/;
if (!latTopPattern.test(html)) throw new Error('LAT_TOP declaration not found');
html = html.replace(latTopPattern, `const LON0 = -117.32, LON1 = -116.82, LAT_TOP = ${LAT_TOP};`);

await writeFile('web/index.html', html);
console.log('web/index.html updated');

function stitchWays(ways) {
  const key = p => p[0].toFixed(7) + ',' + p[1].toFixed(7);
  const segments = ways.map(w => w.slice());
  for (let joined = true; joined;) {
    joined = false;
    outer: for (let i = 0; i < segments.length; i++) {
      for (let j = 0; j < segments.length; j++) {
        if (i === j) continue;
        if (key(segments[i][segments[i].length - 1]) === key(segments[j][0])) {
          segments[i] = segments[i].concat(segments[j].slice(1));
          segments.splice(j, 1);
          joined = true;
          break outer;
        }
      }
    }
  }
  return segments;
}

function perpDist(p, a, b) {
  const [x, y] = p, [x1, y1] = a, [x2, y2] = b;
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

function douglasPeucker(pts, eps) {
  if (pts.length < 3) return pts;
  let maxD = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const left = douglasPeucker(pts.slice(0, idx + 1), eps);
    const right = douglasPeucker(pts.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [pts[0], pts[pts.length - 1]];
}

function buildCoastline(overpassJSON, currentHtml) {
  const ways = overpassJSON.elements.filter(e => e.type === 'way').map(w => w.geometry.map(g => [g.lon, g.lat]));
  const chains = stitchWays(ways);
  // The main chain runs the full La Jolla -> Torrey Pines -> Del Mar span;
  // shorter chains are closed loops (offshore rocks, small inlets) we don't
  // need for the landmass silhouette.
  chains.sort((a, b) => b.length - a.length);
  const trimmed = chains[0].filter(p => p[1] <= LAT_TOP);
  const simplified = douglasPeucker(trimmed, 0.0002).map(([lon, lat]) => [+lon.toFixed(6), +lat.toFixed(6)]);

  const oldCoastMatch = currentHtml.match(/const COAST = \[([\s\S]*?)\[-116\.60,32\.5343\],\[-116\.60,32\.95\],\[-117\.29,32\.95\]\];/);
  if (!oldCoastMatch) throw new Error('could not read existing COAST for splice');
  const oldPts = JSON.parse(`[${oldCoastMatch[1].replace(/,\s*$/, '')}]`);
  // Splice the new, real coastline onto the existing hand-drawn data at
  // whichever old point sits closest to where the new chain ends — south of
  // La Jolla the old trace is unchanged (out of scope for this pass).
  const tail = simplified[simplified.length - 1];
  let bestIdx = 0, bestDist = Infinity;
  oldPts.forEach((p, i) => {
    const d = Math.hypot(p[0] - tail[0], p[1] - tail[1]);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  });
  console.log(`coastline: ${simplified.length} new points, spliced at old index ${bestIdx} (${bestDist.toFixed(4)}deg gap)`);
  return simplified.concat(oldPts.slice(bestIdx), [[-116.60, 32.5343], [-116.60, 32.95], [-117.29, 32.95]]);
}
