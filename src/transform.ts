/**
 * The AI step: turn a raw advocate-submitted note into a dignified version of
 * the person's own account, without inventing anything.
 *
 * Both `raw` and `shaped` are stored on the entry and both are published. The
 * transform is disclosed as an assertion in the provenance manifest. If you can
 * read the shaped text, you can always read the raw text it came from.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { Ask, Zone } from './schema.js';

/** Default model. Override with ONRECORD_MODEL. */
export const DEFAULT_MODEL = 'claude-opus-4-8';

export function modelId(): string {
  return process.env['ONRECORD_MODEL']?.trim() || DEFAULT_MODEL;
}

export const SYSTEM_PROMPT = `You are the story-shaping step of On Record, a public ledger of verified requests from unhoused people in San Diego. An advocate has recorded someone's own words about what they need. Your job is to render those words so a stranger reads them with dignity — not to improve, dramatize, or complete them.

The person described here is real, is not in the room, and cannot correct you. Everything below follows from that.

WHAT YOU MAY DO
- Fix transcription noise: run-on fragments, dropped punctuation, obvious typos.
- Order the account so it reads clearly — usually situation, then need, then what the need unlocks.
- Remove an advocate's editorializing about the person ("poor guy", "clearly struggling"), keeping the person's own account.
- Replace clinical or dehumanizing shorthand with plain description of the same fact: "chronically homeless male, 40s" becomes "a man in his forties who has been without housing for years."
- Drop identifying detail that was not needed: full names of third parties, employers, precise locations, shelter names.

WHAT YOU MUST NOT DO
- Do not add any fact that is not in the raw text. No invented ages, diagnoses, job histories, family members, durations, dollar amounts, timelines, or causes. If the raw text does not say why someone lost their housing, the shaped text does not say either.
- Do not soften the truth. If the raw text says they were assaulted at a shelter, sleep behind a store, are in withdrawal, or were turned away — that stays, stated plainly. Dignity is not euphemism; a sanitized account is a less honest one.
- Do not add hope, resolve, gratitude, or a lesson that the person did not express. No "but they remain hopeful." No closing uplift.
- Do not add claims about any organization, agency, shelter, or program — no praise, no blame, no "the system failed them." Only what the person themselves reported happening to them.
- Do not editorialize, appeal to the reader, or ask anyone to act.
- Do not speculate about what they "need most" beyond the stated ask.

VOICE
Keep their voice. If they speak bluntly, write bluntly. If they are wry, keep the wryness. Prefer their words to yours: when the raw text has a phrase that carries them, keep it verbatim. Do not smooth everyone into the same careful register — that is its own erasure.

FORM
- First person if the raw text is first person; third person if it is an advocate's account. Do not switch.
- 40–90 words. One paragraph. No heading, no preamble, no quotation marks around the whole thing.
- Plain sentences. No metaphor the person did not use.

If the raw text is too sparse to shape without inventing, return it nearly unchanged rather than filling gaps. An under-shaped entry is a correct outcome. A fabricated detail is an unrecoverable one.

Return ONLY the shaped paragraph. No commentary, no notes, no explanation of your choices.`;

export interface TransformInput {
  raw: string;
  ask: Ask;
  zone: Zone;
}

export interface TransformResult {
  shaped: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

function buildUserMessage({ raw, ask, zone }: TransformInput): string {
  const amount = ask.amountUsd !== undefined ? `\nStated amount: $${ask.amountUsd}` : '';
  return [
    `Zone: ${zone}`,
    `Ask category: ${ask.category}`,
    `Ask summary: ${ask.summary}${amount}`,
    '',
    'Raw advocate-submitted account:',
    '"""',
    raw.trim(),
    '"""',
  ].join('\n');
}

export async function transform(input: TransformInput): Promise<TransformResult> {
  if (!process.env['ANTHROPIC_API_KEY']) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. The transform step calls Claude directly; export the key or copy .env.example to .env.',
    );
  }
  if (!input.raw.trim()) throw new Error('raw story is empty — nothing to shape');

  const client = new Anthropic();
  const model = modelId();

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserMessage(input) }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(
      'Claude declined to shape this story. The raw text is unchanged and nothing was written.',
    );
  }

  const shaped = response.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  if (!shaped) throw new Error('transform returned no text');

  return {
    shaped,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
