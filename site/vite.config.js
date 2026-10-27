import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Chaque publication donne au service worker un NOUVEAU numéro de version (la date de construction).
// Le téléphone voit alors que sw.js a changé : il prépare la nouvelle version, et le site affiche
// le bandeau « Nouvelle version disponible · Mettre à jour ».
function versionDuServiceWorker() {
  return {
    name: 'version-du-service-worker',
    apply: 'build',
    closeBundle() {
      const chemin = resolve(import.meta.dirname, 'dist', 'sw.js')
      if (!existsSync(chemin)) return
      const version = `quai-nord-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}`
      writeFileSync(chemin, readFileSync(chemin, 'utf8').replace('"quai-nord-v3"', `"${version}"`))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionDuServiceWorker()],
})
