import type { BambuCloudAdapter } from '../../../packages/printer-adapters/src';

// A dashboard or task list can discover several expired covers at once.
// Share the history request and retain only the identifiers and preview URLs.
export function createThumbnailLookup(adapter: BambuCloudAdapter) {
  async function loadPage(offset: number) {
    const { jobs, nextOffset } = await adapter.history(offset);
    return {
      covers: jobs.map(({ externalId, externalDeviceId, thumbnail }) => ({
        externalId,
        externalDeviceId,
        thumbnail,
      })),
      nextOffset,
    };
  }
  const pages = new Map<number, { until: number; result: ReturnType<typeof loadPage> }>();
  return {
    clear: () => pages.clear(),
    async find(id: string, device: string) {
      let offset: number | null = 0;
      // Same bounded history window as a normal sync. No import or stock update on page views.
      for (let i = 0; offset !== null && i < 5; i++) {
        let page = pages.get(offset);
        if (!page || page.until <= Date.now()) {
          page = { until: Date.now() + 60_000, result: loadPage(offset) };
          pages.set(offset, page);
        }
        const result: Awaited<ReturnType<typeof loadPage>> = await page.result;
        const job = result.covers.find((j) => j.externalId === id && j.externalDeviceId === device);
        if (job) return job.thumbnail;
        offset = result.nextOffset;
      }
      return null;
    },
  };
}
