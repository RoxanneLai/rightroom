import { runComparisonCli } from "../lib/ingestion/discovery-comparison.ts";

async function main(): Promise<void> {
  try {
    console.log(
      JSON.stringify(await runComparisonCli(process.argv.slice(2)), null, 2),
    );
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Discovery comparison failed without exposing private data.",
    );
    process.exitCode = 1;
  }
}

await main();
