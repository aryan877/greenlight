import type { SVGProps } from "react";
import { siGoogle, siGooglegemini, siYoutube } from "simple-icons";

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

export const TrueForgeIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 140 140" role="img" aria-label="TrueForge" {...props}>
    <path
      d="M0 0.02 46.67 23.35v23.32H23.33v46.68h23.34v23.34L0 140.02V.02Z"
      fill="#05090e"
    />
    <path
      d="M140 0 93.33 23.33v23.34h23.34v46.66H93.33v23.34L140 140V0Z"
      fill="#05090e"
    />
    <path
      d="M69.99 46.46c1.24 6.76 3.74 12.06 7.68 15.98 3.93 3.9 9.21 6.35 15.9 7.57-6.69 1.24-11.97 3.73-15.9 7.66-3.94 3.94-6.44 9.25-7.68 15.97-1.24-6.72-3.75-12.03-7.69-15.97-3.94-3.93-9.22-6.42-15.9-7.66 6.68-1.21 11.96-3.66 15.9-7.57 3.95-3.92 6.46-9.22 7.69-15.98Z"
      fill="#6d58fb"
    />
  </svg>
);

export const RemotionIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg viewBox="26 33 358 358" role="img" aria-label="Remotion" {...props}>
    <path
      fill="#0b84f3"
      d="M141.33 92.47c-5.02.27-9.07 1.07-13.15 2.62-2.04.77-5.37 2.43-7.21 3.59-7.68 4.81-13.53 12.05-16.58 20.47-.61 1.67-2.25 6.99-3.31 10.65-7.06 24.47-11.07 51.22-11.93 79.54-.14 4.51-.14 15.25 0 19.69.58 18.77 2.37 35.72 5.62 53.01 1.32 7 3.44 16.39 4.67 20.66 2.51 8.67 7.62 16.06 14.9 21.47 4.88 3.63 10.42 6.06 16.55 7.26 2.96.58 6.86.84 9.73.65 3.98-.26 11.86-1.32 18.27-2.47 28.89-5.15 55.57-14.37 79.77-27.56 15.32-8.36 28.42-17.41 41.06-28.39 12.6-10.93 23.34-22.69 32.79-35.88 2.19-3.05 3.29-4.84 4.39-7.08 2.83-5.79 4.16-11.55 4.15-17.99 0-6-1.13-11.33-3.58-16.78-1.17-2.64-2.3-4.52-4.81-8.11-9.28-13.2-19.57-24.71-32.11-35.89-19.45-17.33-42.54-31.54-68.34-42.06-5.59-2.28-11.09-4.28-17.72-6.45-14.04-4.58-31.41-8.56-46.1-10.54-2.31-.31-5.44-.49-7.08-.41Z"
    />
  </svg>
);
