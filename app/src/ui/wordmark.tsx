type WordmarkProps = {
  tone?: "logo" | "on-band";
  size?: "band" | "signin";
};

export function Wordmark({ tone = "logo", size = "band" }: WordmarkProps) {
  const color = tone === "on-band" ? "text-on-band" : "text-logo";
  const scale = size === "signin" ? "text-signin" : "text-wordmark";
  return (
    <p className={`${scale} ${color} tracking-wordmark w-fit`}>
      <bdi dir="ltr">Flow</bdi>
    </p>
  );
}
