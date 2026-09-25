import { generateFixtures } from "./fixtures/generate";

/**
 * Vitest globalSetup: generates binary fixtures (gitignored) once per run.
 */
export default async function setup(): Promise<void> {
  await generateFixtures();
}
