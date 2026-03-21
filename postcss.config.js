import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

/** Forma esplicita: alcuni ambienti non risolvono bene `plugins: { tailwindcss: {} }`. */
export default {
  plugins: [tailwindcss, autoprefixer],
};
