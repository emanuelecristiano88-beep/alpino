/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_UPLOAD_API_SECRET?: string;
  readonly VITE_ARUCO_MARKER_SIZE_MM: string;
  readonly DEV?: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
