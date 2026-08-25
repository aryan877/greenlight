import type { ImgHTMLAttributes, SVGProps } from "react";
import { Aperture, type LucideProps } from "lucide-react";
import { siGoogle, siGooglegemini, siYoutube } from "simple-icons";

import remotionMark from "./assets/remotion-mark.svg";
import trueForgeLogomark from "./assets/trueforge-logomark.svg";

type IconData = { hex: string; path: string; title: string };

export const BrandIcon = ({
  icon,
  title,
  ...props
}: SVGProps<SVGSVGElement> & { icon: IconData; title?: string }) => (
  <svg
    viewBox="0 0 24 24"
    role="img"
    aria-label={title ?? icon.title}
    {...props}
  >
    <path fill={`#${icon.hex}`} d={icon.path} />
  </svg>
);

export const YouTubeIcon = (props: SVGProps<SVGSVGElement>) => (
  <BrandIcon icon={siYoutube} {...props} />
);

export const GoogleIcon = (props: SVGProps<SVGSVGElement>) => (
  <BrandIcon icon={siGoogle} {...props} />
);

export const GeminiIcon = (props: SVGProps<SVGSVGElement>) => (
  <BrandIcon icon={siGooglegemini} {...props} />
);

export const GreenlightMark = (props: LucideProps) => (
  <Aperture aria-label="Greenlight" role="img" {...props} />
);

export const TrueForgeIcon = (props: ImgHTMLAttributes<HTMLImageElement>) => (
  <img src={trueForgeLogomark} alt="TrueForge" {...props} />
);

export const RemotionIcon = (props: ImgHTMLAttributes<HTMLImageElement>) => (
  <img src={remotionMark} alt="Remotion" {...props} />
);
