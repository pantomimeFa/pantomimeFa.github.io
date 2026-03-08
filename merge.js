const fs = require('fs');
const path = require('path');

const tempDir = path.join(__dirname, 'temp');
const dataDir = path.join(__dirname, 'data');

function merge(mode) {
  const categories = [];
  const files = fs.readdirSync(tempDir).filter(f => f.startsWith(mode + '_') && f.endsWith('.json'));

  for (const file of files) {
    const raw = fs.readFileSync(path.join(tempDir, file), 'utf8');
    try {
      const cat = JSON.parse(raw);
      categories.push(cat);
    } catch (e) {
      console.error(`Error parsing ${file}:`, e.message);
    }
  }

  // Sort categories in desired order
  const order = [
    'celebrities', 'movies', 'general', 'objects', 'food', 'technology',
    'sports', 'places', 'history', 'books', 'jobs', 'animals', 'music',
    'cities', 'abstract', 'proverbs', 'football', 'celebrity', 'cartoons', 'children'
  ];
  categories.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  const output = { categories };
  fs.writeFileSync(
    path.join(dataDir, mode + '.json'),
    JSON.stringify(output, null, 2),
    'utf8'
  );
  console.log(`${mode}.json: ${categories.length} categories merged`);
  for (const cat of categories) {
    const levels = Object.keys(cat.levels);
    const counts = levels.map(l => `L${l}:${cat.levels[l].length}`).join(', ');
    console.log(`  ${cat.id}: ${counts}`);
  }
}

merge('fast');
merge('normal');
