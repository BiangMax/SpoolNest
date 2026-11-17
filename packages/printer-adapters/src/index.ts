import type { z } from 'zod';
import { jobSchema } from '../../shared/src';
export type ImportedJob = z.infer<typeof jobSchema> & {
  externalId: string;
  externalDeviceId: string;
  thumbnail: string | null;
};
export interface PrinterAdapter {
  readonly source: string;
  testConnection(): Promise<{ devices: unknown[] }>;
  history(
    offset: number,
  ): Promise<{ jobs: ImportedJob[]; nextOffset: number | null; warnings: string[] }>;
  disconnect(): void;
}
export { BambuCloudAdapter, parseCloudTask } from './bambu-cloud';
export { parse3mf } from './three-mf';
