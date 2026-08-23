/**
 * Brand.jsx
 * Application logo and branding component.
 */
export default function Brand({ theme, onClick }) {
  // Use the black logo as the default from UI/UX, or white if dark theme (future-proof)
  // import.meta.env.BASE_URL is replaced at build time with the Vite base ('./')
  // so the logo resolves correctly from both file:// (Electron) and HTTP server.
  const logoSrc = theme === 'dark'
    ? `${import.meta.env.BASE_URL}sdc-logo-white.png`
    : `${import.meta.env.BASE_URL}sdc-logo-black.png`;
  
  return (
    <div className="brandbar" onClick={onClick}>
      <img src={logoSrc} alt="SDC" className="brand-logo" />
      <span className="brand-sub">Assemblies Library</span>
    </div>
  );
}
