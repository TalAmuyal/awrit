import { execSync } from 'node:child_process';

function toKebabCase(str: string): string {
  return str
    .replace(/_color$/, '')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

/** Get kitty colors and transform them to CSS variables */
export function getKittyColorsAsCSS(tailwind = false): string {
  try {
    // Run the kitty command and get the output
    const output = execSync('kitten @ get-colors').toString();

    // Process each line
    const cssVars = output
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const [name, value] = line.split(/\s+/);
        if (name === 'foreground') {
          return `  --color-kitty-fg: ${value};`;
        }

        if (name === 'background') {
          return `  --color-kitty-bg: ${value};`;
        }

        return `  --color-${toKebabCase(name)}: ${value};`;
      })
      .join('\n');

    return `${tailwind ? '@theme' : ':root'} {\n${cssVars}\n}`;
  } catch (error) {
    console.error('Error getting kitty colors:', error);
    return '';
  }
}

// for running directly
if (require.main === module) {
  console.log(getKittyColorsAsCSS());
}
