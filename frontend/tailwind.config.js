/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [
    require("@tailwindcss/typography"),
    require("tailwindcss-animate"),
    function ({ addUtilities }) {
      addUtilities({
        ".custom-scrollbar": {
          "&::-webkit-scrollbar": {
            width: "10px",
            height: "10px",
          },
          "&::-webkit-scrollbar-track": {
            background: "#f3f4f6",
            borderRadius: "10px",
            margin: "5px 0",
          },
          "&::-webkit-scrollbar-thumb": {
            background: "linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)",
            borderRadius: "10px",
            border: "2px solid #f3f4f6",
          },
          "&::-webkit-scrollbar-thumb:hover": {
            background: "linear-gradient(180deg, #2563eb 0%, #1e40af 100%)",
            boxShadow: "0 0 6px rgba(59, 130, 246, 0.4)",
          },
        },
      });
    },
  ],
};
