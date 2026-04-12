/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // VS Code-inspired dark theme
        app: {
          bg: '#1e1e1e',
          sidebar: '#252526',
          panel: '#1e1e1e',
          header: '#3c3c3c',
          border: '#404040',
          hover: '#2a2d2e',
          active: '#094771',
          input: '#3c3c3c'
        },
        text: {
          primary: '#cccccc',
          secondary: '#9d9d9d',
          muted: '#6b6b6b',
          link: '#4fc1ff'
        },
        accent: {
          blue: '#0078d4',
          green: '#4ec9b0',
          red: '#f44747',
          yellow: '#cca700',
          orange: '#ce9178'
        }
      },
      fontFamily: {
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'Cascadia Code',
          'Consolas',
          'Monaco',
          'monospace'
        ]
      },
      fontSize: {
        '2xs': '0.625rem'
      }
    }
  },
  plugins: []
}
