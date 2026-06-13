// Stand-in tool: crashes with no usable output. Should normalize to ERROR.
process.stderr.write('boom\n');
process.exit(1);
