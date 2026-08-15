import { Canvas, Color, HStack, Image, RoundedRectangle, Spacer, Text, VStack, Widget, ZStack } from "scripting";
import { ALIPAY_URL, getRefreshMinutes, loadWidgetData, type WidgetData } from "./data";

const BLUE = "#102d83";
const WHITE = "#ffffff";

type Content = "V" | "L";

function transparentFill(): Color {
  return Widget.isTransparentMode || Widget.isBlurMode || Widget.isTransparentBackground ? "rgba(0,0,0,0)" : BLUE;
}


function contentParameter(): Content | null {
  const value = (Widget.parameter ?? "").trim().toUpperCase();
  if (value === "V") return "V";
  if (value === "L") return "L";
  return null;
}

function Card({ title, icon, items, large = false }: { title: string; icon: string; items: string[][]; large?: boolean }) {
  const borderWidth = large ? 4 : 2;
  return (
    <ZStack alignment="center" padding={large ? 6 : 3} frame={{ maxWidth: "infinity", maxHeight: "infinity", minHeight: large ? 280 : 140 }}>
      <RoundedRectangle cornerRadius={large ? 24 : 14} fill={transparentFill()} stroke={{ shapeStyle: WHITE, strokeStyle: { lineWidth: borderWidth } }} />
      <VStack alignment="leading" spacing={large ? 14 : 8} padding={large ? 20 : 12}>
        <HStack alignment="center" spacing={large ? 12 : 7}>
          <Image systemName={icon} foregroundStyle={WHITE} frame={{ width: large ? 54 : 38, height: large ? 54 : 38 }} />
          <Text font={large ? "title2" : "subheadline"} fontWeight="bold" foregroundStyle={WHITE} lineLimit={1} minScaleFactor={0.65}>{title}</Text>
        </HStack>
        {items.map(([label, value], index) => (
          <HStack key={`${label}-${index}`} alignment="center">
            <Text font={large ? "body" : "caption"} foregroundStyle={WHITE} lineLimit={1} minScaleFactor={0.55}>{label}</Text>
            <Spacer />
            <Text font={large ? "body" : "caption"} fontWeight="medium" foregroundStyle={WHITE} lineLimit={1} minScaleFactor={0.55}>{value}</Text>
          </HStack>
        ))}
      </VStack>
    </ZStack>
  );
}

function VehicleCard({ data, large = false }: { data: WidgetData; large?: boolean }) {
  return <Card large={large} title={data.vehicleTitle} icon="car.fill" items={[["车辆状态", data.vehicleStatus], ["未处违法", `${data.violationCount} 条`], ["上次更新", data.updatedAt], ["年检日期", data.vehicleInspectionDate]]} />;
}

function LicenseCard({ data, large = false }: { data: WidgetData; large?: boolean }) {
  return <Card large={large} title={data.licenseTitle} icon="creditcard.fill" items={[["证件状态", data.licenseStatus], ["累计扣分", `${data.cumulativePoint} 分`], ["重置日期", data.resetDate], ["换证日期", data.licenseChangeDate]]} />;
}

function ExpiredCard({ title, icon }: { title: string; icon: string }) {
  return <Card title={title} icon={icon} items={[["状态", "Token 已失效"], ["操作", "点击打开支付宝"], ["提示", "更新后自动恢复"], ["数据", "暂不可用"]]} />;
}

function TokenExpiredWidget({ data }: { data: WidgetData }) {
  const content = contentParameter();
  return (
    <VStack alignment="center" spacing={6} padding={6} background={transparentFill()} widgetURL={ALIPAY_URL}>
      {Widget.family === "systemMedium" || Widget.family === "systemExtraLarge" ? (
        <DualCardLayout data={data} large={Widget.family === "systemExtraLarge"} />
      ) : Widget.family === "systemLarge" ? (
        <VStack alignment="center" spacing={10}>
          {content === "V" ? <ExpiredCard title={data.vehicleTitle} icon="car.fill" /> : content === "L" ? <ExpiredCard title={data.licenseTitle} icon="creditcard.fill" /> : <><ExpiredCard title={data.vehicleTitle} icon="car.fill" /><ExpiredCard title={data.licenseTitle} icon="creditcard.fill" /></>}
        </VStack>
      ) : (
        <ExpiredCard title={content === "L" ? data.licenseTitle : data.vehicleTitle} icon={content === "L" ? "creditcard.fill" : "car.fill"} />
      )}
    </VStack>
  );
}

function ParameterPromptWidget() {
  return (
    <VStack alignment="center" spacing={8} padding={12} background={transparentFill()}>
      <Card title="交管 12123" icon="info.circle.fill" items={[["提示", "请设置参数"], ["参数", "V：车辆信息"], ["参数", "L：驾照信息"]]} />
    </VStack>
  );
}

function SmallWidget({ data }: { data: WidgetData }) {
  const content = contentParameter();
  if (!content) return <ParameterPromptWidget />;
  return (
    <VStack alignment="center" spacing={8} padding={12} background={transparentFill()}>
      {content === "L" ? <LicenseCard data={data} /> : <VehicleCard data={data} />}
      {data.error ? <Text font="caption" foregroundStyle={WHITE}>{data.error}</Text> : null}
    </VStack>
  );
}

function LargeWidget({ data }: { data: WidgetData }) {
  return (
    <VStack alignment="center" spacing={10} padding={12} background={transparentFill()}>
      <VehicleCard data={data} />
      <LicenseCard data={data} />
    </VStack>
  );
}

function DualCardLayout({ data, large = false, scale = 1 }: { data: WidgetData; large?: boolean; scale?: number | { x: number; y: number } }) {
  return (
    <VStack alignment="center" spacing={large ? 12 : 6} padding={large ? 12 : 6} background={transparentFill()} scaleEffect={scale}>
      <HStack spacing={8} alignment="center" frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
        <VehicleCard data={data} large={large} />
        <LicenseCard data={data} large={large} />
      </HStack>
    </VStack>
  );
}
function clampGaugeValue(value: string, max = 18): number {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.max(0, Math.min(max, number)) : 0;
}

function CircularWidget({ data }: { data: WidgetData }) {
  const violationNumber = Number.parseInt(data.violationCount, 10);
  const pointNumber = Number.parseInt(data.cumulativePoint, 10);
  const violations = Number.isFinite(violationNumber) ? Math.max(0, violationNumber) : 0;
  const points = Number.isFinite(pointNumber) ? Math.max(0, pointNumber) : 0;
  const violationGauge = Math.min(18, violations);
  const pointGauge = Math.min(18, points);
  return (
    <ZStack alignment="center">
      <Canvas
        draw={(ctx, size) => {
          const centerX = size.width / 2;
          const centerY = size.height / 2;
          const radius = Math.min(size.width, size.height) * 0.42;
          const tickRadius = radius * 0.9;
          const gaugeWidth = 3;
          const drawHalf = (right: boolean, value: number) => {
            const start = Math.PI / 2;
            const direction = right ? -1 : 1;
            const end = start + direction * Math.PI;
            const fraction = value / 18;
            const filledEnd = start + direction * Math.PI * fraction;

            ctx.lineWidth = gaugeWidth;
            ctx.lineCap = "round";
            ctx.strokeStyle = "rgba(255,255,255,0.25)";
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, start, end, right);
            ctx.stroke();

            ctx.strokeStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, start, filledEnd, right);
            ctx.stroke();

            ctx.lineWidth = gaugeWidth;
            ctx.strokeStyle = "rgba(255,255,255,0.55)";
            for (let index = 0; index <= 18; index += 1) {
              const angle = start + direction * Math.PI * (index / 18);
              const x1 = centerX + Math.cos(angle) * (tickRadius - gaugeWidth / 2);
              const y1 = centerY + Math.sin(angle) * (tickRadius - gaugeWidth / 2);
              const x2 = centerX + Math.cos(angle) * (tickRadius + gaugeWidth / 2);
              const y2 = centerY + Math.sin(angle) * (tickRadius + gaugeWidth / 2);
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y2);
              ctx.stroke();
            }
          };

          drawHalf(false, violationGauge);
          drawHalf(true, pointGauge);

          // 右侧 12 分分隔线：仅保留与圆环线宽相同的短圆润线段。
          const markerAngle = Math.PI / 2 - Math.PI * (12 / 18);
          ctx.lineWidth = gaugeWidth;
          ctx.lineCap = "round";
          ctx.strokeStyle = "#ffffff";
          ctx.beginPath();
          ctx.moveTo(centerX + Math.cos(markerAngle) * (radius - gaugeWidth / 2), centerY + Math.sin(markerAngle) * (radius - gaugeWidth / 2));
          ctx.lineTo(centerX + Math.cos(markerAngle) * (radius + gaugeWidth / 2), centerY + Math.sin(markerAngle) * (radius + gaugeWidth / 2));
          ctx.stroke();
        }}
        frame={{ width: 76, height: 76 }}
      />
      <HStack alignment="center" spacing={2} frame={{ width: 54, height: 34 }}>
        <Text font="caption2" foregroundStyle={WHITE} multilineTextAlignment="center" minScaleFactor={0.5} lineLimit={2} frame={{ width: 26, height: 30 }}>{`违法\n${violations}`}</Text>
        <Text font="caption2" foregroundStyle={WHITE} multilineTextAlignment="center" minScaleFactor={0.5} lineLimit={2} frame={{ width: 26, height: 30 }}>{`扣分\n${points}`}</Text>
      </HStack>
    </ZStack>
  );
}


function InlineProgressWidget({ data }: { data: WidgetData }) {
  const violationNumber = Number.parseInt(data.violationCount, 10);
  const pointNumber = Number.parseInt(data.cumulativePoint, 10);
  const violations = Number.isFinite(violationNumber) ? Math.max(0, Math.min(18, violationNumber)) : 0;
  const points = Number.isFinite(pointNumber) ? Math.max(0, Math.min(18, pointNumber)) : 0;
  return (
    <Canvas
      draw={(ctx, size) => {
        const center = size.width / 2;
        const y = size.height / 2;
        const half = size.width / 2;
        const width = Math.max(3, size.height * 0.7);
        ctx.lineWidth = width;
        ctx.lineCap = "round";

        ctx.strokeStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(center, y);
        ctx.lineTo(center - half * (violations / 18), y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(center, y);
        ctx.lineTo(center + half * (points / 18), y);
        ctx.stroke();

        // 显示左右两侧共 18 个分度，右侧 12 分分度使用更明显的标记。
        ctx.lineCap = "butt";
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        for (let index = 0; index <= 18; index += 1) {
          const leftX = center - half * (index / 18);
          const rightX = center + half * (index / 18);
          ctx.beginPath();
          ctx.moveTo(leftX, y - size.height * 0.35);
          ctx.lineTo(leftX, y + size.height * 0.35);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(rightX, y - size.height * 0.35);
          ctx.lineTo(rightX, y + size.height * 0.35);
          ctx.stroke();
        }

        const twelveX = center + half * (12 / 18);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(twelveX, y - size.height * 0.5);
        ctx.lineTo(twelveX, y + size.height * 0.5);
        ctx.stroke();
      }}
      frame={{ maxWidth: "infinity", height: 14 }}
    />
  );
}
function RectangularWidget({ data }: { data: WidgetData }) {
  return (
    <VStack alignment="leading" spacing={1} padding={5} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>
      <Text font="caption2" foregroundStyle={WHITE} minScaleFactor={0.55} lineLimit={1}>{`未处违法 ${data.violationCount} 条`}</Text>
      <Text font="caption2" foregroundStyle={WHITE} minScaleFactor={0.55} lineLimit={1}>{`累计扣分 ${data.cumulativePoint} 分`}</Text>
      <Text font="caption2" foregroundStyle={WHITE} minScaleFactor={0.5} lineLimit={1}>{`年检日期 ${data.vehicleInspectionDate}`}</Text>
      <Text font="caption2" foregroundStyle={WHITE} minScaleFactor={0.5} lineLimit={1}>{`换证日期 ${data.licenseChangeDate}`}</Text>
    </VStack>
  );
}
function WidgetView({ data }: { data: WidgetData }) {
  if (Widget.family === "accessoryCircular") return <CircularWidget data={data} />;
  if (Widget.family === "accessoryInline") return <InlineProgressWidget data={data} />;
  if (Widget.family === "accessoryRectangular") return <RectangularWidget data={data} />;
  if (data.error?.includes("Token 已失效")) return <TokenExpiredWidget data={data} />;
  if (Widget.family === "systemExtraLarge") return <DualCardLayout data={data} large />;
  if (Widget.family === "systemMedium") return <DualCardLayout data={data} />;
  if (Widget.family === "systemLarge") return <LargeWidget data={data} />;
  return <SmallWidget data={data} />;
}

export default function PreviewWidget() {
  return <WidgetView data={{ vehicleTitle: "苏 A·12345", violationCount: "2", vehicleStatus: "正常", updatedAt: "10:00", vehicleInspectionDate: "2026-12-31", licenseTitle: "驾驶证 C1", licenseStatus: "正常", cumulativePoint: "3", resetDate: "07-31", licenseChangeDate: "2027-07-31" }} />;
}

async function main() {
  const data = await loadWidgetData();
  Widget.present(<WidgetView data={data} />, {
    policy: "after",
    date: new Date(Date.now() + getRefreshMinutes() * 60 * 1000),
  });
}

main();
