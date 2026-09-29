/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string | undefined;
  readonly VITE_SUPABASE_ANON_KEY: string | undefined;
  readonly VITE_REVIEWER_BUILD: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
