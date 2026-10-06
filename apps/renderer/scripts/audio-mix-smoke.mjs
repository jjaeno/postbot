import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { FfmpegPostProcessor } from '../dist/render-engine.js';
const run = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'postbot-audio-smoke-'));
try {
  const video = join(directory, 'video.mp4');
  await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=180x320:d=2', '-an', '-c:v', 'libx264', video]);
  const tracks = await Promise.all([440, 220, 880].map(async (frequency, index) => {
    const path = join(directory, `track-${index}.wav`);
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=0.6`, '-ar', '16000', path]);
    return path;
  }));
  const processor = new FfmpegPostProcessor();
  for (const mode of ['all', 'bgm', 'sfx', 'silent']) {
    const output = join(directory, `${mode}.mp4`);
    await processor.postprocess({ videoInput: video, output, ...(mode === 'all' ? { narrationInput: tracks[0] } : {}), ...(['all', 'bgm'].includes(mode) ? { backgroundInput: tracks[1], backgroundVolume: 0.2 } : {}), ...(['all', 'sfx'].includes(mode) ? { effectsInput: tracks[2], effectsVolume: 0.1 } : {}) });
    const probe = await processor.probe(output);
    assert.equal(probe.width, 180); assert.equal(probe.height, 320);
    assert.ok(probe.durationSeconds >= 1.9 && probe.durationSeconds < 3, `${mode} duration`);
    assert.equal(probe.hasAudio, mode !== 'silent');
    if (mode !== 'silent') assert.ok(Number.isFinite(probe.meanVolumeDb));
    console.log(JSON.stringify({ mode, ...probe }));
  }
  await assert.rejects(processor.postprocess({ videoInput: video, output: join(directory, 'invalid.mp4'), backgroundInput: tracks[1], backgroundVolume: 2 }), /AUDIO_VOLUME_INVALID/);
  console.log('AUDIO_MIX_SMOKE_PASS');
} finally { await rm(directory, { recursive: true, force: true }); }
