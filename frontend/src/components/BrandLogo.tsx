export default function BrandLogo({ size = 36 }: { size?: number }) {
  return (
    <img
      src="/logo.png"
      width={size}
      height={size}
      alt="ULINK LLC logo"
      className="brand-logo-image"
    />
  );
}
