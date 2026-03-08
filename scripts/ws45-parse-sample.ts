import fs from 'node:fs';
import { parseWs45ForecastText } from '@/lib/server/ws45ForecastIngest';

const path = process.argv[2] || '/tmp/ws45.txt';
const text = fs.readFileSync(path, 'utf8');
const parsed = parseWs45ForecastText(text);

console.log(JSON.stringify(parsed, null, 2));
