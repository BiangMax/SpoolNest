import type { z } from 'zod';
import { jobSchema } from '../../shared/src';
import type { CloudFilament } from './bambu-cloud';
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
  filament(): Promise<{ spools: CloudFilament[]; warnings: string[] }>;
  disconnect(): void;
}
export { BambuCloudAdapter, parseCloudTask, parseCloudFilament } from './bambu-cloud';
export type { CloudFilament } from './bambu-cloud';
export { parse3mf } from './three-mf';
