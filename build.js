/**
 * SAS Player — Production Build Script
 * Multi-layer security pipeline:
 *  1. Terser: minification, dead code elimination, console stripping
 *  2. JavaScript-Obfuscator: control-flow flattening, string array encryption, identifier mangling
 *
 * Usage: npm run build:client
 *
 * Source files:  sas-realtime.js, sas-player-script.js
 * Output files:  sas-realtime.min.js, sas-player-script.min.js
 */

const { minify } = require('terser');
const JavaScriptObfuscator = require('javascript-obfuscator');
const fs = require('fs');
const path = require('path');

const FILES = [
  { src: 'sas-realtime.js', out: 'sas-realtime.min.js' },
  { src: 'sas-player-script.js', out: 'sas-player-script.min.js' },
];

const TERSER_OPTIONS = {
  compress: {
    dead_code: true,
    drop_console: true,         // Strip ALL console.* calls
    drop_debugger: true,
    passes: 2,
    pure_funcs: ['console.log', 'console.warn', 'console.error', 'console.info'],
    global_defs: {
      DEBUG: false,
    },
  },
  mangle: {
    toplevel: false,
    properties: false,
  },
  format: {
    comments: false,
    ascii_only: true,
  },
  sourceMap: false,
};

const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: true,
  identifierNamesGenerator: 'hexadecimal',
  log: false,
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ['base64'],
  stringArrayIndexShift: true,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayThreshold: 0.8,
  transformObjectKeys: false,
  reservedNames: ['^SAS$', '^YT$', '^onYouTubeIframeAPIReady$'],
};

async function build() {
  const rootDir = __dirname;

  for (const file of FILES) {
    const srcPath = path.join(rootDir, file.src);
    const outPath = path.join(rootDir, file.out);

    if (!fs.existsSync(srcPath)) {
      process.stderr.write(`[SKIP] ${file.src} not found\n`);
      continue;
    }

    const source = fs.readFileSync(srcPath, 'utf-8');

    // Step 1: Terser minification & console dropping
    const terserResult = await minify(source, TERSER_OPTIONS);
    if (terserResult.error) {
      process.stderr.write(`[ERROR Terser] ${file.src}: ${terserResult.error}\n`);
      process.exit(1);
    }

    // Step 2: High-grade Obfuscation
    const obfuscationResult = JavaScriptObfuscator.obfuscate(
      terserResult.code,
      OBFUSCATOR_OPTIONS
    );
    const finalCode = obfuscationResult.getObfuscatedCode();

    fs.writeFileSync(outPath, finalCode, 'utf-8');

    const srcSize = (source.length / 1024).toFixed(1);
    const outSize = (finalCode.length / 1024).toFixed(1);
    process.stdout.write(`[OK] ${file.src} (${srcSize}KB) -> Minified + Obfuscated -> ${file.out} (${outSize}KB)\n`);
  }

  process.stdout.write('\nBuild complete. Client bundles minified and obfuscated.\n');
}

build().catch(err => {
  process.stderr.write(`Build failed: ${err.message}\n`);
  process.exit(1);
});
