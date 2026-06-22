const fs = require('fs');
const path = require('path');
const toml = require('smol-toml');

describe('Language Files Integrity Test', () => {
  let enUS;
  let custom;
  
  beforeAll(() => {
    const enUSPath = path.join(__dirname, '../app/assets/lang/en_US.toml');
    const customPath = path.join(__dirname, '../app/assets/lang/_custom.toml');
    
    // Parse en_US.toml
    const enUSContent = fs.readFileSync(enUSPath, 'utf-8');
    enUS = toml.parse(enUSContent);
    
    // Parse _custom.toml
    if (fs.existsSync(customPath)) {
      const customContent = fs.readFileSync(customPath, 'utf-8');
      custom = toml.parse(customContent);
    }
  });

  // Helper function to resolve dot-notation path like 'js.settings.authAccount.logout'
  const resolvePath = (obj, pathString) => {
    return pathString.split('.').reduce((o, i) => o ? o[i] : undefined, obj);
  };

  test('en_US.toml should parse without errors', () => {
    expect(enUS).toBeDefined();
    expect(typeof enUS).toBe('object');
  });

  test('Crucial language keys must not be empty', () => {
    const keysToCheck = [
      'ejs.app.title',
      'js.settings.fileSelectors.executables',
      'js.login.error.unknown.title'
    ].filter(key => !key.includes('${'));

    keysToCheck.forEach(key => {
      const val = resolvePath(enUS, key);
      expect(val).toBeDefined();
      expect(typeof val).toBe('string');
      expect(val.trim().length).toBeGreaterThan(0);
    });
  });

  test('All Lang.queryJS and Lang.queryEJS calls in source files must have matching keys in TOML', () => {
    const jsDir = path.join(__dirname, '../app/assets/js');
    
    // Recursive function to get all js/jsx files
    const getAllFiles = (dirPath, arrayOfFiles) => {
      const files = fs.readdirSync(dirPath);
      arrayOfFiles = arrayOfFiles || [];
      
      files.forEach((file) => {
        if (fs.statSync(dirPath + "/" + file).isDirectory()) {
          arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
        } else {
          if (file.endsWith('.js') || file.endsWith('.jsx')) {
            arrayOfFiles.push(path.join(dirPath, file));
          }
        }
      });
      return arrayOfFiles;
    };
    
    const allFiles = getAllFiles(jsDir);
    let missingKeys = [];
    
    // Regex to match Lang.queryJS('something') and Lang.queryEJS('something')
    const regexJS = /Lang\.queryJS\(['"`](.*?)['"`]\)/g;
    const regexEJS = /Lang\.queryEJS\(['"`](.*?)['"`]\)/g;
    
    allFiles.forEach(file => {
      const content = fs.readFileSync(file, 'utf-8');
      
      let match;
      while ((match = regexJS.exec(content)) !== null) {
        const fullKey = 'js.' + match[1];
        if (fullKey.includes('${')) continue;
        if (!resolvePath(enUS, fullKey) && (!custom || !resolvePath(custom, fullKey))) {
          missingKeys.push(`File: ${path.basename(file)} | Key: ${fullKey}`);
        }
      }
      
      while ((match = regexEJS.exec(content)) !== null) {
        const fullKey = 'ejs.' + match[1];
        if (fullKey.includes('${')) continue;
        if (!resolvePath(enUS, fullKey) && (!custom || !resolvePath(custom, fullKey))) {
          missingKeys.push(`File: ${path.basename(file)} | Key: ${fullKey}`);
        }
      }
    });
    
    // Remove duplicates
    missingKeys = [...new Set(missingKeys)];
    
    // Test fails if there are missing keys
    expect(missingKeys).toEqual([]);
  });
});
