/**
 * Voice clone utilities — list, find, and clone voices from local files.
 *
 * Usage:
 *   npx tsx scripts/voice-utils.ts list              — list all voices on ElevenLabs
 *   npx tsx scripts/voice-utils.ts find <name>       — find a voice by name
 *   npx tsx scripts/voice-utils.ts clone <file> <name> [description]  — clone from local audio
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Load .env.local manually
const envPath = resolve(process.cwd(), '.env.local');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const BASE_URL = 'https://api.elevenlabs.io/v1';

function getApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    console.error('ELEVENLABS_API_KEY not set. Add it to .env.local');
    process.exit(1);
  }
  return key;
}

async function listVoices() {
  const resp = await fetch(`${BASE_URL}/voices`, {
    headers: { 'xi-api-key': getApiKey() },
  });
  if (!resp.ok) {
    console.error('Failed:', resp.status, await resp.text());
    return;
  }
  const data = await resp.json() as { voices: Array<{ voice_id: string; name: string; category: string }> };
  console.log(`Found ${data.voices.length} voices:\n`);
  for (const v of data.voices) {
    const tag = v.category === 'cloned' ? ' [CLONED]' : '';
    console.log(`  ${v.voice_id}  ${v.name}${tag}`);
  }
}

async function findVoice(name: string) {
  const resp = await fetch(`${BASE_URL}/voices`, {
    headers: { 'xi-api-key': getApiKey() },
  });
  if (!resp.ok) {
    console.error('Failed:', resp.status, await resp.text());
    return;
  }
  const data = await resp.json() as { voices: Array<{ voice_id: string; name: string; category: string }> };
  const matches = data.voices.filter((v) => v.name.toLowerCase().includes(name.toLowerCase()));
  if (matches.length === 0) {
    console.log(`No voices matching "${name}"`);
    return;
  }
  console.log(`Found ${matches.length} match(es):\n`);
  for (const v of matches) {
    console.log(`  voice_id: ${v.voice_id}`);
    console.log(`  name:     ${v.name}`);
    console.log(`  category: ${v.category}`);
    console.log();
  }
}

async function cloneFromFile(filePath: string, name: string, description?: string) {
  const audioBuffer = readFileSync(filePath);
  console.log(`Read ${audioBuffer.length} bytes from ${filePath}`);

  const formData = new FormData();
  formData.append('name', name.slice(0, 100));
  formData.append('files', new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mpeg' }), 'sample.mp3');
  formData.append('remove_background_noise', 'true');
  if (description) formData.append('description', description.slice(0, 500));

  console.log(`Cloning voice "${name}"...`);
  const resp = await fetch(`${BASE_URL}/voices/add`, {
    method: 'POST',
    headers: { 'xi-api-key': getApiKey() },
    body: formData,
  });

  if (!resp.ok) {
    console.error('Clone failed:', resp.status, await resp.text());
    return;
  }

  const data = await resp.json() as { voice_id: string };
  console.log(`\nSuccess! Voice ID: ${data.voice_id}`);
  console.log(`\nTo use in browser console on the watch page:`);
  console.log(`  localStorage.setItem('invideo-voice-clone-ch-${name}', '${data.voice_id}')`);
}

const [,, cmd, ...args] = process.argv;

switch (cmd) {
  case 'list':
    listVoices();
    break;
  case 'find':
    findVoice(args[0] || 'chalk');
    break;
  case 'clone':
    if (!args[0] || !args[1]) {
      console.error('Usage: npx tsx scripts/voice-utils.ts clone <audio-file> <name> [description]');
      process.exit(1);
    }
    cloneFromFile(args[0], args[1], args[2]);
    break;
  default:
    console.log('Usage:');
    console.log('  npx tsx scripts/voice-utils.ts list');
    console.log('  npx tsx scripts/voice-utils.ts find <name>');
    console.log('  npx tsx scripts/voice-utils.ts clone <file> <name> [description]');
}
