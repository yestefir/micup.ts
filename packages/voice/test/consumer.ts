import { Readable } from 'node:stream';
import { openSource, type AudioInputStream } from '../dist/index.js';

const input: AudioInputStream = Readable.from([Buffer.from('audio')]);
openSource(input);
