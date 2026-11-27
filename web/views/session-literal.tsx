import { Code } from '@mantine/core';

interface SessionLiteralProps { text: string; }

export const SessionLiteral = ({ text }: SessionLiteralProps) => {
  const parts = text.split(/(^[ \t]+|[ \t]+$|\S{120,}|[ \t]{2,}|\t)/u);
  return <>{parts.map((part, i) => /^[ \t]+$/.test(part)
    ? <Code key={i} block display="inline" p={0} bg="transparent" fz="inherit" ff="inherit">{part}</Code>
    : /^\S{120,}$/u.test(part) ? <Code key={i} block p={0} bg="transparent" fz="inherit" ff="inherit" maw="100%">{part}</Code> : part)}
  </>;
};
