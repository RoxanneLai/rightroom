import {
  runComparisonReviewCli,
  safeComparisonReviewError,
} from "../lib/ingestion/discovery-comparison-review.ts";

async function main(): Promise<void> {
  try {
    console.log(
      JSON.stringify(
        await runComparisonReviewCli(process.argv.slice(2)),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(safeComparisonReviewError(error));
    process.exitCode = 1;
  }
}

await main();
