type AvatarProps = {
  name: string;
};

export function Avatar({ name }: AvatarProps) {
  const letter = name.trim().slice(0, 1);
  return (
    <span className="ui-avatar" role="img" aria-label={name}>
      {letter}
    </span>
  );
}
