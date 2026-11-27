import { Code, Text } from '@mantine/core';
import { CallTokenText } from './call-token-text.js';

interface JsonHighlighterProps {
  json?: string;
  secretsMap?: Map<string, { key: string; realValue?: string; count?: number; alias: string }>;
}

export const JsonHighlighter = ({ json, secretsMap }: JsonHighlighterProps) => {
  if (!json || typeof json !== 'string') {
    return <Code block fz="xs">—</Code>;
  }
  const tokenRegex = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|[{}[\],:])/g;

  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(json)) !== null) {
    if (match.index > lastIndex) {
      elements.push(json.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `token-${match.index}`;

    if (token.endsWith(':')) {
      const propName = token.slice(0, -1);
      elements.push(
        <Text component="span" key={key} c="blue.4" fw={600}>
          {propName}
          <Text component="span" c="gray.5">:</Text>
        </Text>
      );
    } else if (token.startsWith('"')) {
      elements.push(
        <Text component="span" key={key} c="teal.4">
          <CallTokenText text={token} secretsMap={secretsMap} />
        </Text>
      );
    } else if (token === 'true' || token === 'false') {
      elements.push(<Text component="span" key={key} c="orange.4" fw={600}>{token}</Text>);
    } else if (token === 'null') {
      elements.push(<Text component="span" key={key} c="dimmed" fs="italic">{token}</Text>);
    } else if (/^-?\d/.test(token)) {
      elements.push(<Text component="span" key={key} c="grape.4">{token}</Text>);
    } else {
      elements.push(<Text component="span" key={key} c="gray.5">{token}</Text>);
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < json.length) {
    elements.push(json.slice(lastIndex));
  }

  return (
    <Code block fz="xs">
      {elements}
    </Code>
  );
};
