const fs = require('fs');
const path = require('path');

const directory = path.join(__dirname, '..', 'lib');

fs.readdirSync(directory).forEach((file) => {
    if (file.endsWith('.js')) {
        fs.renameSync(path.join(directory, file), path.join(directory, file.replace(/\.js$/, '.cjs')));
    }
});
