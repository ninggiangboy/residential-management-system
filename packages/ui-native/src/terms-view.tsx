import {
  parseTermsMarkdown,
  type TermsBlock,
  type TermsInline,
  type TermsListItem,
} from '@rms/shared-types'
import { Linking, View } from 'react-native'
import { Text } from './text'

function InlineNode({ node }: { node: TermsInline }) {
  switch (node.type) {
    case 'text':
      return node.text
    case 'break':
      return '\n'
    case 'bold':
      return (
        <Text variant="body-strong">
          <Inline nodes={node.children} />
        </Text>
      )
    case 'italic':
      return (
        <Text variant="body" className="italic">
          <Inline nodes={node.children} />
        </Text>
      )
    case 'link':
      return (
        <Text
          variant="body"
          tone="teal"
          className="underline"
          onPress={() => void Linking.openURL(node.href)}
        >
          {node.text}
        </Text>
      )
  }
}

function Inline({ nodes }: { nodes: TermsInline[] }) {
  return (
    <>
      {nodes.map((node, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: inline nodes have no identity of their own
        <InlineNode key={index} node={node} />
      ))}
    </>
  )
}

function Items({ items, ordered }: { items: TermsListItem[]; ordered: boolean }) {
  return (
    <View className="gap-1">
      {items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: list items have no identity of their own
        <View key={index} className="gap-1">
          <View className="flex-row gap-2">
            <Text variant="body">{ordered ? `${index + 1}.` : '•'}</Text>
            <Text variant="body" className="flex-1">
              <Inline nodes={item.inline} />
            </Text>
          </View>
          {item.children.length > 0 ? (
            <View className="pl-5">
              <Items items={item.children} ordered={ordered} />
            </View>
          ) : null}
        </View>
      ))}
    </View>
  )
}

/**
 * Renders the restricted Markdown of the terms and the privacy notice from the blocks of `parseTermsMarkdown`, the one parser the
 * API validates with (DOC-36 §8, DR-126). Nothing is injected as HTML; a text that does not parse renders as plain paragraphs.
 */
export function TermsView({ text }: { text: string }) {
  const parsed = parseTermsMarkdown(text)
  const blocks: TermsBlock[] = Array.isArray(parsed)
    ? parsed
    : [{ type: 'paragraph', inline: [{ type: 'text', text }] }]
  return (
    <View className="gap-4">
      {blocks.map((block, index) => {
        const key = index
        if (block.type === 'heading')
          return (
            <Text
              key={key}
              variant={block.level === 2 ? 'title-2' : 'title-3'}
              accessibilityRole="header"
            >
              <Inline nodes={block.inline} />
            </Text>
          )
        if (block.type === 'list')
          return <Items key={key} items={block.items} ordered={block.ordered} />
        return (
          <Text key={key} variant="body">
            <Inline nodes={block.inline} />
          </Text>
        )
      })}
    </View>
  )
}
