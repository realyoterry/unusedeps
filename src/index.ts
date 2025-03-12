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
export function getFiles(dir: string, visited = new Set<string>()): string[] {
    let results: string[] = [];

    try {
        const realPath = fs.realpathSync(dir);
        if (!realPath || visited.has(realPath)) return results;
        visited.add(realPath);

        const list = fs.readdirSync(realPath);
        const extensions = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs'];

        for (const file of list) {
            const filePath = path.join(realPath, file);
            let stat;

            try {
                stat = fs.lstatSync(filePath);
            } catch {
                continue;
            }

            if (stat.isSymbolicLink()) continue;

            if (stat.isDirectory()) {
                if (filePath.includes('node_modules') || filePath.includes('.vscode') || filePath.includes('.git')) continue;
                results = results.concat(getFiles(filePath, visited));
            } else if (extensions.includes(path.extname(file))) {
                results.push(filePath);
            }
        }
    } catch (err) {
        console.error(`Error reading directory: ${dir}`, err);
    }

    return results;
}

/**
 * Checks if a given dependency is used in the project by searching for import or require statements.
 *
 * @param {string} dependency - The name of the dependency to search for.
 * @returns {boolean} Returns whether the dependency is used in the code.
 */
export function dependencyUsed(dependency: string): boolean {
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
export function scriptUsed(dependency: string): boolean {
    const scripts: Record<string, string> = packageJSON.scripts || {};
    return Object.values(scripts).some((script: string) => script.includes(dependency));
}

/**
 * Retrieves a list of globally installed packages.
 *
 * @returns {string[]} An array of global package names.
 */
export function getGlobal(): string[] {
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
export function remove(dependencies: string[], global: boolean = false): void {
    if (dependencies.length === 0) return;

    const startTime = Date.now();

    const uninstallNext = (index: number) => {
        if (index >= dependencies.length) {
            const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`\nRemoved ${dependencies.length} dependenc${dependencies.length > 1 ? 'ies' : 'y'} in ${elapsedTime} seconds.`);
            return;
        }

        const dep = dependencies[index];

        exec(`npm uninstall ${dep} ${global ? '-g' : ''}`, (err, _, stderr) => {
            if (err) {
                console.error(`\nError uninstalling ${dep}:`, stderr);
            } else {
                readline.clearLine(process.stdout, 0);
                readline.cursorTo(process.stdout, 0);
                console.log(`- Removed ${dep}`);
            }

            uninstallNext(index + 1);
        });
    };

    uninstallNext(0);
}

/**
 * Finds and removes unused dependencies in the project.
 *
 * - Scans all dependencies from package.json
 * - Scans global CLI packages
 * - Filters out dependencies that are neither imported nor used in scripts
 * - Prompts the user to remove some or all unused dependencies
 */
export function main(): void {
    const allDeps = [...Object.keys(packageJSON.dependencies || {}), ...Object.keys(packageJSON.devDependencies || {})];
    const unused = allDeps.filter(dep => !dependencyUsed(dep) && !scriptUsed(dep));
    const global = getGlobal();

    if (!unused.length && !global.length) return console.log('No unused dependencies found.');
    [...unused, ...global.map((dep) => `${dep} (global)`)].forEach((dep, i) => console.log(`${i + 1}. ${dep}`));

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    rl.question('\nEnter numbers to remove (e.g. 1, 2, 4) or "all": ', answer => {
        rl.close();

        if (answer.toLowerCase() === 'all') {
            remove(unused);
            return remove(global, true);
        }

        const selectedDeps = [...new Set(answer.match(/\d/g)?.map((n) => [...unused, ...global][+n - 1]) || [])];

        remove(selectedDeps.filter(dep => !global.includes(dep)));
        remove(selectedDeps.filter(dep => global.includes(dep)), true);
    });
}

// fix so main() is not called for imports.
if (require.main === module) {
    // wait 500ms to ensure no extra
    // warnings were created by node.
    setTimeout(() => {
        main();
    }, 500);
}
