// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import viteConfig from '../vite.config';

type BuildConfig = {
  build?: { outDir?: string; sourcemap?: unknown; rollupOptions?: { output?: { manualChunks?: unknown } } };
};

// Feature: cloudflare-pages-deployment, Property 1: Build System Compatibility
describe('Build System Compatibility', () => {
  it('should generate valid production configuration', async () => {
    // Mock process.cwd
    vi.spyOn(process, 'cwd').mockReturnValue('/tmp');

    await fc.assert(
      fc.asyncProperty(fc.constant('production'), async (mode) => {
        // We need to cast viteConfig to any because it's a function but TS might see it as UserConfigExport
        const configFn = viteConfig as unknown as (env: { mode: string; command: string }) => Promise<BuildConfig>;
        const config = await configFn({ mode, command: 'build' });

        // Check output directory
        expect(config.build?.outDir).toBe('dist');
        
        // Check sourcemap is disabled for production
        expect(config.build?.sourcemap).toBe(false);
        
        // Check manual chunks are configured
        expect(config.build?.rollupOptions?.output?.manualChunks).toBeDefined();
        const chunks = config.build?.rollupOptions?.output?.manualChunks;
        expect(typeof chunks).toBe('function');
      })
    );
  });
});
