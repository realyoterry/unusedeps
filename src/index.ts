#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { exec, execSync } from 'child_process';

// package.json dummy interface
interface PackageJSON {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
}

// prettier-ignore
const exclusions = [
    'typescript',
];

const packageJSON: PackageJSON = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));

/**
 * Retrieves all JavaScript and TypeScript files from a directory.
 * @param {string} dir - The directory to get files
 * @returns {string[]} An array of file paths that match the specified extensions.
 */
function getFiles(dir: string): string[] {
    let results: string[] = [];

    const list = fs.readdirSync(dir);
    const extensions = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'];

    list.forEach((file) => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);

        if (stat && stat.isDirectory()) {
            if (file.includes('node_modules') || file.includes('.vscode') || file.includes('.git')) return;
            results = results.concat(getFiles(file));
        } else if (extensions.includes(path.extname(file))) {
            results.push(file);
        }
    });

    return results;
}

/**
 * Checks if a given dependency is used in the project by searching for import or require statements.
 *
 * @param {string} dependency - The name of the dependency to search for.
 * @returns {boolean} Returns whether the dependency is used in the code.
 */
function dependencyUsed(dependency: string): boolean {
    const files = getFiles(process.cwd());

    return files.some((file) => {
        const fileContent = fs.readFileSync(file, 'utf8');

        if (exclusions.includes(dependency) || dependency.startsWith('@types/')) {
            return true;
        }

        // prettier-ignore
        return fileContent.includes(`require('${dependency}')`) ||
            fileContent.includes(`import '${dependency}'`) ||
            fileContent.includes(`import "${dependency}"`) ||
            fileContent.includes(`from '${dependency}'`) ||
            fileContent.includes(`from "${dependency}"`) ||
            fileContent.includes(`import('${dependency}')`) ||
            fileContent.includes(`import("${dependency}")`);
    });
}

/**
 * Checks if a given dependency is used in package.json scripts.
 *
 * @param {string} dependency - The name of the dependency to search for.
 * @returns {boolean} Returns whether the dependency is used in package.json.
 */
function scriptUsed(dependency: string): boolean {
    const scripts: Record<string, string> = packageJSON.scripts || {};
    return Object.values(scripts).some((script: string) => script.includes(dependency));
}

/**
 * Retrieves a list of globally installed packages.
 *
 * @returns {string[]} An array of global package names.
 */
function getGlobal(): string[] {
    try {
        const result = execSync('npm ls -g --depth=0 --json').toString();
        const globalPackages: PackageJSON = JSON.parse(result);
        return Object.keys(globalPackages.dependencies || {});
    } catch (error) {
        console.error('Error retrieving global packages:', error);
        return [];
    }
}

/**
 * Removes a list of npm dependencies and refreshes node_modules.
 *
 * @param {string[]} dependencies - An array of dependency names to uninstall.
 * @param {boolean} [global] - Whether the package is global or not.
 */
function remove(dependencies: string[], global: boolean = false): void {
    dependencies.forEach((dep) => {
        process.stdout.write(`Uninstalling ${dep}...`);

        exec(`npm uninstall ${dep} ${global ? '-g' : ''}`, (err, _, stderr) => {
            if (err) {
                console.error(`\nError uninstalling ${dep}:`, stderr);
            } else {
                readline.clearLine(process.stdout, 0);
                readline.cursorTo(process.stdout, 0);
                console.log(`Uninstalled ${dep} ✅`);
            }
        });
    });
}

/**
 * Finds and removes unused dependencies in the project.
 *
 * - Scans all dependencies from package.json
 * - Scans global CLI packages
 * - Filters out dependencies that are neither imported nor used in scripts
 * - Prompts the user to remove some or all unused dependencies
 */
function main(): void {
    // code is a bit confusing to read, I
    // might find a cleaner way to do this soon.
    const dependencies: string[] = Object.keys(packageJSON.dependencies || {});
    const devDependencies: string[] = Object.keys(packageJSON.devDependencies || {});
    const unusedDeps: string[] = [...dependencies, ...devDependencies].filter((dep) => !dependencyUsed(dep) && !scriptUsed(dep));
    const globalDeps: string[] = getGlobal();

    if (unusedDeps.length === 0 && globalDeps.length === 0) {
        return console.log('No unused dependencies found.');
    }

    console.log('Unused dependencies found:');

    unusedDeps.forEach((dep, index) => console.log(`${index + 1}. ${dep}`));
    globalDeps.forEach((dep, index) => console.log(`${index + 1 + unusedDeps.length}. ${dep} (global)`));

    const rl: readline.Interface = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    rl.question('\nEnter the numbers of the dependencies you want to remove (comma-separated), or type "all": ', (answer: string) => {
        rl.close();

        const allDeps = [...unusedDeps, ...globalDeps];

        if (answer.toLowerCase() === 'all') {
            remove(unusedDeps);
            remove(globalDeps, true);
        } else if (answer.includes(',') || !Number.isNaN(Number(answer))) {
            const selectedIndexes = answer
                .split(',')
                .map((num) => parseInt(num.trim(), 10) - 1)
                .filter((num) => num >= 0 && num < allDeps.length);

            const selectedDeps = selectedIndexes.map((i) => allDeps[i]);
            const globalSelectedDeps = selectedDeps.filter((dep) => globalDeps.includes(dep));
            const localSelectedDeps = selectedDeps.filter((dep) => !globalDeps.includes(dep));

            remove(localSelectedDeps);
            remove(globalSelectedDeps, true);
        } else {
            return console.log('Exiting because of invalid input.');
        }
    });
}

// wait 500ms to ensure no extra
// warnings were created by node.
setTimeout(() => {
    main();
}, 500);
