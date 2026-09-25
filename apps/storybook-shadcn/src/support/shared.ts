/**
 * Framework-free story support is shared with the Mantine Storybook
 * (read-only import): fixture schema/rows, the instrumented in-memory data
 * source Playwright inspects via `window.__sg`, scripted remote edits and the
 * demo-api client.
 */
export * from "../../../storybook/src/support/data";
export * from "../../../storybook/src/support/scripted";
export * from "../../../storybook/src/support/demoApi";
