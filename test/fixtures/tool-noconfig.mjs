// Stand-in tool: not configured for this repo. Exits non-zero with the
// "no config found" notice the skip() detector looks for.
process.stdout.write('No faketool.config.json found (searched up from cwd).\n');
process.exit(2);
