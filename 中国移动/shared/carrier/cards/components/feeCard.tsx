// shared/carrier/cards/components/feeCard.tsx
import {
  VStack,
  HStack,
  Text,
  Image,
  Spacer,
  Widget,
} from "scripting"
import { timeStyle, RingCardTheme } from "../../theme"

export function FeeCard(props: {
  title: string
  valueText: string
  theme: RingCardTheme
  logoPath?: string | null
  updateTime: string
}) {
  const { title, valueText, theme, logoPath, updateTime } = props
  const isUrlLogo =
    !!logoPath && (logoPath.startsWith("http://") || logoPath.startsWith("https://"))
  const transparent = Widget.isTransparentMode || Widget.isBlurMode || Widget.isTransparentBackground
  const cardBackground = {
    style: transparent
      ? ({ light: "rgba(255,255,255,0.58)", dark: "rgba(0,0,0,0.46)" } as any)
      : theme.bg,
    shape: { type: "rect", cornerRadius: 18, style: "continuous" },
  } as any

  const LogoImage = ({ size }: { size: number }) =>
    logoPath ? (
      isUrlLogo ? (
        <Image imageUrl={logoPath} resizable frame={{ width: size, height: size }} />
      ) : (
        <Image filePath={logoPath} resizable frame={{ width: size, height: size }} />
      )
    ) : (
      <Image
        systemName={theme.icon}
        font={size}
        fontWeight="semibold"
        foregroundStyle={theme.tint}
      />
    )

  return (
    <VStack
      alignment="center"
      padding={{ top: 10, leading: 10, bottom: 10, trailing: 10 }}
      frame={{ minWidth: 0, maxWidth: Infinity }}
      {...(transparent ? { background: cardBackground } : { widgetBackground: cardBackground })}
    >
      <Spacer minLength={2} />
      <VStack alignment="center" spacing={2} frame={{ width: 80, height: 56 }}>
        <Spacer />
        <LogoImage size={36} />
        <HStack
          alignment="center"
          spacing={3}
          frame={{ minWidth: 0, maxWidth: Infinity }}
        >
          <Image
            systemName="arrow.triangle.2.circlepath"
            font={5}
            foregroundStyle={timeStyle}
          />
          <Text
            font={12}
            foregroundStyle={timeStyle}
            lineLimit={1}
            minScaleFactor={0.8}
          >
            {updateTime}
          </Text>
        </HStack>
        <Spacer />
      </VStack>

      <Spacer minLength={6} />
      <Text
        font={15}
        fontWeight="semibold"
        foregroundStyle={theme.tint}
        lineLimit={1}
        minScaleFactor={0.7}
      >
        {valueText}
      </Text>
      <Spacer minLength={2} />
      <Text
        font={10}
        fontWeight="semibold"
        foregroundStyle={theme.tint}
        lineLimit={1}
        minScaleFactor={0.7}
      >
        {title}
      </Text>
      <Spacer minLength={4} />
    </VStack>
  )
}