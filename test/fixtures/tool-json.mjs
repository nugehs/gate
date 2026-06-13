// Stand-in tool: emits clean JSON on stdout, exits 0.
process.stdout.write(JSON.stringify({ ok: true, value: 42 }) + '\n');
