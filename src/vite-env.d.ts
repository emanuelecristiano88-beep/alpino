/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_UPLOAD_API_SECRET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
