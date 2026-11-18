// Runs after npm install. On a Mac it builds the brightness helper (real screen dimming); on Windows there's nothing
// to build (brightness goes through Windows' own controls), so this works the same everywhere.
if (process.platform === 'darwin') {
  try { require('child_process').execFileSync('sh', [require('path').join(__dirname, 'build-brightness.sh')], { stdio: 'inherit' }); } catch {}
} else console.log('apoji-brightness: not needed on ' + process.platform);
