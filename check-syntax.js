const fs = require('fs');

// Read the HTML file
const html = fs.readFileSync('frontend/index.html', 'utf-8');

// Extract the script content
const scriptStart = html.indexOf('<script>') + 8;
const scriptEnd = html.indexOf('</script>');
const script = html.substring(scriptStart, scriptEnd);

// Write the script to a temp file
fs.writeFileSync('temp-script.js', script);

// Try to parse it with Node.js
const vm = require('vm');
try {
    new vm.Script(script);
    console.log('✅ Script parses successfully');
} catch (err) {
    console.log('❌ Syntax Error:');
    console.log(`Error: ${err.message}`);
    console.log(`Line: ${err.stack}`);
    
    // Find the problematic line
    const lines = script.split('\n');
    const errorMatch = err.stack.match(/:(\d+):/);
    if (errorMatch) {
        const lineNum = parseInt(errorMatch[1]) - 1;
        console.log(`\nProblematic area (around line ${lineNum}):`);
        for (let i = Math.max(0, lineNum - 3); i < Math.min(lines.length, lineNum + 3); i++) {
            console.log(`${i + 1}: ${lines[i]}`);
        }
    }
}
