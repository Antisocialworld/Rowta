const fs = require('fs');
const path = require('path');

/**
 * ============================================================================
 * Design Token to CSS Variables Converter
 * ============================================================================
 * 
 * This script reads design tokens from JSON files located next to this script 
 * and converts them into a single, cohesive CSS file containing CSS custom properties (variables).
 * 
 * Key Features:
 * - Differentiates between "Primitive/Reference Colors" and "Color Rules/Roles".
 * - Primitive Colors: Foundational colors (e.g., brand colors, neutrals) that define the palette.
 * - Color Rules (Roles): Functional colors (e.g., surface, error, primary) applied directly to UI elements.
 * - Intelligently maps Color Rules to reference the Primitive Colors via CSS variables (var(--...)).
 * - Generates comprehensive documentation within the output CSS.
 */

// Define the directory containing the token files
const TOKENS_DIR = __dirname;
const OUTPUT_CSS_FILE = path.join(__dirname, 'design-variables.css');

// Define the input token files
const TOKEN_FILES = [
    'design-tokens.token.json',
    'design-tokens.tokens.json',
    'design-tokens.tokenss.json',
    'design-tokens.material3.json' // additions from Google Material 3 (warning, success, missing roles, shape, state); see README.md
];

/**
 * Utility to normalize string names into valid, kebab-case CSS variable names.
 * Example: "Primary Color Role" -> "primary-color-role"
 * 
 * @param {string} name - The original name from the JSON token.
 * @returns {string} - The normalized CSS variable name part.
 */
function normalizeName(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric chars with hyphens
        .replace(/(^-|-$)/g, '');    // Trim leading or trailing hyphens
}

/**
 * Utility to format dimension values as rem.
 * Converts px values to rem based on 16px base.
 * 
 * @param {number|string} value - The dimension value.
 * @returns {string} - Formatted CSS value in rem.
 */
function formatRem(value) {
    if (typeof value === 'number' && value !== 0) {
        const rem = value / 16;
        return `${rem}rem`;
    }
    return value;
}

/**
 * Utility to format dimension values as px.
 * Keeps shadows, border-widths, and icon sizes fixed.
 * 
 * @param {number|string} value - The dimension value.
 * @returns {string} - Formatted CSS value.
 */
function formatDimension(value) {
    if (typeof value === 'number' && value !== 0) {
        return `${value}px`;
    }
    return value;
}

/**
 * Flatten groups nested inside a category into [name, token] pairs.
 * A token is an object with "value" (and "type"); typography entries are objects with "fontSize".
 * Anything else that is an object is treated as a group and searched one level deeper.
 */
function flattenTokens(items, isTypography) {
    const out = [];
    for (const [key, token] of Object.entries(items)) {
        const isLeaf = token && typeof token === 'object' &&
            (token.value !== undefined || token.type !== undefined || (isTypography && token.fontSize));
        if (isLeaf || !token || typeof token !== 'object') {
            out.push([key, token]);
        } else {
            out.push(...flattenTokens(token, isTypography));
        }
    }
    return out;
}

/**
 * Deep merge multiple token JSON objects into a single object for unified processing.
 * 
 * @param {string[]} files - Array of filenames to process.
 * @returns {Object} - The merged token data.
 */
function mergeTokens(files) {
    const mergedTokens = {};
    for (const file of files) {
        const filePath = path.join(TOKENS_DIR, file);
        if (fs.existsSync(filePath)) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const jsonData = JSON.parse(content);
                Object.assign(mergedTokens, jsonData);
                console.log(`✅ Loaded tokens from: ${file}`);
            } catch (err) {
                console.error(`❌ Failed to parse JSON in ${file}:`, err.message);
            }
        } else {
            console.warn(`⚠️ Warning: Token file not found - ${file}`);
        }
    }
    return mergedTokens;
}

/**
 * Main function to parse tokens and generate the CSS content.
 */
function generateCSSVariables() {
    console.log('\nStarting token conversion process...');
    const tokens = mergeTokens(TOKEN_FILES);

    // Data structures to hold our parsed variables
    const primitives = [];
    const roles = [];
    const typography = [];
    const spacing = [];
    const effects = [];
    const shapes = [];
    const states = [];
    // Marks tokens that come from the Material 3 additions file instead of the owner's Figma export.
    const tagOf = t => (t.extensions && t.extensions.material3) ? ' /* + Material 3 (see design-tokens.material3.json) */' : '';
    const fontFamilies = [];

    // Map to keep track of Primitive Colors for referencing in Color Rules
    // Key: Hex color value (lowercase), Value: CSS variable name
    const primitiveColorsMap = new Map();

    // Iterate over top-level categories in the merged JSON
    for (const [category, items] of Object.entries(tokens)) {
        const categoryLower = category.toLowerCase();
        const isRole = categoryLower.includes('role') || categoryLower.includes('rule') ||
                       categoryLower.includes('inverse surface') || categoryLower.includes('surface tint'); // FIX: these are roles
        const isTypography = categoryLower.includes('typography');
        const isSpacing = categoryLower.includes('spacing');
        const isEffect = categoryLower.includes('effect') || categoryLower.includes('shadow');
        const isShape = categoryLower === 'shape';
        const isState = categoryLower.includes('state layer');
        const isFontFamily = categoryLower.includes('font') && categoryLower.includes('family');

        // Iterate over individual tokens within the category.
        // FIX: groups nested inside a category (for example the "inverse surface" group, which holds
        // inverse surface, inverse on surface, surface tint and surface tint color) used to be skipped.
        // They are now flattened; the token name is the innermost key, as for every other token.
        for (const [key, token] of flattenTokens(items, isTypography)) {
            const baseName = normalizeName(key);

            if (isFontFamily && token.type === 'fontFamily') {
                // Process Font Family Tokens
                fontFamilies.push(`  --font-family-${baseName}: ${token.value};`);
            } else if (isTypography && token.fontSize) {
                // Process Typography Tokens
                for (const [prop, data] of Object.entries(token)) {
                    if (data && data.value !== undefined) {
                        let val = data.value;
                        if (data.type === 'dimension') val = formatDimension(val); // FIX: px, as in the delivered design-variables.css (the old code wrote rem, which did not match the file)
                        typography.push(`  --font-${baseName}-${normalizeName(prop)}: ${val};`);
                    }
                }
            } else if (isEffect && token.type === 'custom-shadow' && token.value) {
                // Process Effects / Shadows
                const { offsetX, offsetY, radius, spread, color } = token.value;
                const shadowValue = `${formatDimension(offsetX)} ${formatDimension(offsetY)} ${formatDimension(radius)} ${formatDimension(spread)} ${color}`;
                effects.push(`  --shadow-${baseName}: ${shadowValue};`);
            } else if (isShape && token.type === 'dimension') {
                shapes.push(`  --shape-${baseName}: ${formatDimension(token.value)};${tagOf(token)}`);
            } else if (isState && token.type === 'number') {
                states.push(`  --state-${baseName}: ${token.value};${tagOf(token)}`);
            } else if (isSpacing || token.type === 'dimension') {
                // Process Spacing
                spacing.push(`  --spacing-${baseName}: ${formatRem(token.value)};`);
            } else if (token.type === 'color') {
                // Process Colors (Distinguishing Primitives vs Rules/Roles)
                const varName = `--color-${baseName}`;
                
                if (isRole) {
                    // It's a Color Rule/Role. We store it to process in a second pass.
                    // This ensures all primitives are loaded before we attempt to map them.
                    roles.push({ varName, value: token.value, originalKey: key, tag: tagOf(token) });
                } else {
                    // It's a Primitive/Reference Color.
                    primitives.push(`  ${varName}: ${token.value};${tagOf(token)}`);
                    
                    // Add to map so roles can reference it
                    // Assuming color values are hex strings, normalize to lowercase for mapping
                    // FIX: keep EVERY primitive with this value (the old code kept only the last one, so
                    // "on-primary" pointed at error-100). The role picks its own family below.
                    if (typeof token.value === 'string') {
                        const k = token.value.toLowerCase();
                        if (!primitiveColorsMap.has(k)) primitiveColorsMap.set(k, []);
                        primitiveColorsMap.get(k).push(varName);
                    }
                }
            }
        }
    }

    // Process Color Rules/Roles and map them to primitives where possible
    // FIX: which ramp a role should point at. Material 3: primary/secondary/tertiary/error roles use their own
    // ramp; surfaces and inverse roles use neutral; surface variant and outlines use neutral variant.
    // The VALUE is identical whichever ramp is chosen; this only keeps the link semantically right.
    function preferredFamilies(roleVar) {
        const n = roleVar.replace('--color-', '');
        if (n === 'surface-variant' || n === 'on-surface-variant' || n.startsWith('outline')) return ['neutral-variant', 'neutral'];
        if (n.includes('surface') || n === 'background' || n === 'on-background' || n === 'scrim' || n === 'shadow') return ['neutral', 'neutral-variant'];
        if (n.includes('warning')) return ['warning'];
        if (n.includes('success')) return ['success'];
        if (n.includes('primary')) return ['pry', 'primary'];
        if (n.includes('secondary')) return ['secondary'];
        if (n.includes('tertiary')) return ['tertiary'];
        if (n.includes('error')) return ['error'];
        return [];
    }
    function pickPrimitive(role) {
        const candidates = primitiveColorsMap.get(role.value.toLowerCase()) || [];
        for (const fam of preferredFamilies(role.varName)) {
            const hit = candidates.find(c => new RegExp('^--color-' + fam + '-\\d+$').test(c));
            if (hit) return hit;
        }
        return candidates[candidates.length - 1]; // no family match: same as the old behaviour
    }
    const mappedRoles = roles.map(role => {
        const primitiveVar = pickPrimitive(role);
        if (primitiveVar) {
            // Found a matching primitive! Map the rule to the primitive CSS variable.
            return `  ${role.varName}: var(${primitiveVar}); /* mapped from foundational color: ${role.value} */${role.tag}`;
        } else {
            // No matching primitive found. Fallback to the hardcoded value.
            return `  ${role.varName}: ${role.value}; /* direct value (no primitive match) */${role.tag}`;
        }
    });

    // Assemble the final CSS file content
    let cssContent = `/**
 * ============================================================================
 * DESIGN SYSTEM CSS VARIABLES
 * Auto-generated from design tokens.
 * ============================================================================
 */

:root {
`;

    if (primitives.length > 0) {
        cssContent += `  /* ---------------------------------------- */\n`;
        cssContent += `  /* Primitive / Reference Colors             */\n`;
        cssContent += `  /* Foundational colors not used directly.   */\n`;
        cssContent += `  /* ---------------------------------------- */\n`;
        cssContent += `${primitives.join('\n')}\n\n`;
    }

    if (mappedRoles.length > 0) {
        cssContent += `  /* ---------------------------------------- */\n`;
        cssContent += `  /* Color Rules / Roles                      */\n`;
        cssContent += `  /* Applied directly to UI components.       */\n`;
        cssContent += `  /* ---------------------------------------- */\n`;
        cssContent += `${mappedRoles.join('\n')}\n\n`;
    }

    if (fontFamilies.length > 0) {
        cssContent += `  /* ---------------------------------------- */\n`;
        cssContent += `  /* Font Families                             */\n`;
        cssContent += `  /* ---------------------------------------- */\n`;
        cssContent += `${fontFamilies.join('\n')}\n\n`;
    }

    if (typography.length > 0) {
        cssContent += `  /* ---------------------------------------- */\n`;
        cssContent += `  /* Typography                               */\n`;
        cssContent += `  /* ---------------------------------------- */\n`;
        cssContent += `${typography.join('\n')}\n\n`;
    }

    if (spacing.length > 0) {
        cssContent += `  /* ---------------------------------------- */\n`;
        cssContent += `  /* Spacing                                  */\n`;
        cssContent += `  /* ---------------------------------------- */\n`;
        cssContent += `${spacing.join('\n')}\n\n`;
    }

    if (shapes.length > 0) {
        cssContent += `  /* ---------------------------------------- */\n`;
        cssContent += `  /* Shape (corner radius)                    */\n`;
        cssContent += `  /* ---------------------------------------- */\n`;
        cssContent += `${shapes.join('\n')}\n\n`;
    }

    if (states.length > 0) {
        cssContent += `  /* ---------------------------------------- */\n`;
        cssContent += `  /* State layers (opacity)                   */\n`;
        cssContent += `  /* ---------------------------------------- */\n`;
        cssContent += `${states.join('\n')}\n\n`;
    }

    if (effects.length > 0) {
        cssContent += `  /* ---------------------------------------- */\n`;
        cssContent += `  /* Effects & Shadows                        */\n`;
        cssContent += `  /* ---------------------------------------- */\n`;
        cssContent += `${effects.join('\n')}\n`;
    }

    cssContent += `}\n`;

    // Write the output CSS to disk
    try {
        fs.writeFileSync(OUTPUT_CSS_FILE, cssContent, 'utf8');
        console.log(`\n🎉 Successfully generated CSS variables at: ${OUTPUT_CSS_FILE}`);
        console.log(`Summary:`);
        console.log(`- 🎨 Primitive Colors: ${primitives.length}`);
        console.log(`- 🖌️ Color Rules (Roles): ${roles.length}`);
        console.log(`- 📝 Typography Vars: ${typography.length}`);
        console.log(`- 🔤 Font Families: ${fontFamilies.length}`);
        console.log(`- 📏 Spacing Vars: ${spacing.length}`);
        console.log(`- 🌟 Effects/Shadows: ${effects.length}`);
    } catch (err) {
        console.error('❌ Failed to write CSS file:', err.message);
    }
}

// Execute the generation
generateCSSVariables();
