import fs from 'node:fs';
import path from 'node:path';
import { runReplayBenchmark, type ReplayBenchmarkFixture } from '@/lib/ar/replayBenchmark';

type CliArgs = {
  fixturePath: string;
  outputPath?: string;
  json: boolean;
  quiet: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args = argv.slice(2);

  const fixtureArg = args.find((arg) => arg.startsWith('--fixture='));
  const outputArg = args.find((arg) => arg.startsWith('--output='));

  return {
    fixturePath: fixtureArg ? fixtureArg.split('=')[1] : 'scripts/fixtures/ar-trajectory-replay-fixture.json',
    outputPath: outputArg ? outputArg.split('=')[1] : undefined,
    json: args.includes('--json'),
    quiet: args.includes('--quiet')
  };
}

function readFixtureFromDisk(fixturePathArg: string): ReplayBenchmarkFixture {
  const fixturePath = path.resolve(process.cwd(), fixturePathArg);
  const raw = fs.readFileSync(fixturePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Replay fixture must be a JSON object');
  }

  const fixture = parsed as ReplayBenchmarkFixture;
  if (!Array.isArray(fixture.cases)) {
    throw new Error('Replay fixture is missing cases[]');
  }
  return fixture;
}

function fmt(value: number) {
  return value.toFixed(3);
}

function printHumanSummary(report: ReturnType<typeof runReplayBenchmark>, fixturePath: string) {
  console.log('AR trajectory replay benchmark');
  console.log(`Fixture: ${fixturePath}`);
  if (report.fixtureSeed) console.log(`Seed: ${report.fixtureSeed}`);
  console.log(
    `Cases: ${report.evaluatedCaseCount}/${report.fixtureCaseCount} evaluated; samples=${report.sampleCount}; skipped=${report.skippedCases.length}`
  );
  console.log('');

  if (report.overall) {
    console.log('Overall');
    console.log(
      `  mean=${fmt(report.overall.meanErrorDeg)}deg p50=${fmt(report.overall.p50ErrorDeg)}deg p90=${fmt(report.overall.p90ErrorDeg)}deg p95=${fmt(report.overall.p95ErrorDeg)}deg`
    );
    console.log(
      `  drift=${fmt(report.overall.driftDeg)}deg (start=${fmt(report.overall.startMeanErrorDeg)}deg, end=${fmt(report.overall.endMeanErrorDeg)}deg), slope=${fmt(report.overall.slopeDegPerMin)}deg/min`
    );
    console.log('');
  } else {
    console.log('Overall: no benchmark samples available.');
    console.log('');
  }

  if (report.cases.length) {
    console.log('Per case');
    for (const row of report.cases) {
      console.log(
        `  - ${row.id}: n=${row.sampleCount}, p50=${fmt(row.p50ErrorDeg)}deg, p90=${fmt(row.p90ErrorDeg)}deg, p95=${fmt(row.p95ErrorDeg)}deg, drift=${fmt(row.driftDeg)}deg, slope=${fmt(row.slopeDegPerMin)}deg/min`
      );
    }
    console.log('');
  }

  if (report.skippedCases.length) {
    console.log('Skipped');
    for (const row of report.skippedCases) {
      console.log(`  - ${row.id}: ${row.reason}`);
    }
  }
}

function writeReportOutput(outputPathArg: string, report: ReturnType<typeof runReplayBenchmark>) {
  const outputPath = path.resolve(process.cwd(), outputPathArg);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return outputPath;
}

function main() {
  const args = parseArgs(process.argv);
  const fixture = readFixtureFromDisk(args.fixturePath);
  const report = runReplayBenchmark(fixture);

  if (!args.quiet && !args.json) {
    printHumanSummary(report, args.fixturePath);
  }
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  }

  if (args.outputPath) {
    const outputPath = writeReportOutput(args.outputPath, report);
    if (!args.quiet) {
      console.log(`Wrote replay benchmark report: ${outputPath}`);
    }
  }

  if (report.sampleCount === 0) {
    throw new Error('Replay benchmark produced no samples.');
  }
}

main();
