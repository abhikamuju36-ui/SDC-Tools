/** @type {import('tailwindcss').Config} */
const path = require('path');

// __dirname on Windows uses backslashes; fast-glob needs forward slashes
const clientDir = __dirname.split(path.sep).join('/');

module.exports = {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    `${clientDir}/index.html`,
    `${clientDir}/src/**/*.{js,jsx}`,
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: '#061d39',
          blue: '#1574c4',
          lightBlue: '#aacee8',
          yellow: '#ffde51',
          green: '#74c415',
          lime: '#befa4f',
          gray: '#d9d9d9',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
