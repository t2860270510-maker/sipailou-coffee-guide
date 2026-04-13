import { cafes } from "./cafes";

function formatCafeContext(index: number) {
  const cafe = cafes[index];
  return [
    `${cafe.id} | ${cafe.name}`,
    `gate=${cafe.nearestGate}; walk=${cafe.walkTimeMin}min/${cafe.walkDistanceM}m; weekday=${cafe.weekdayHours}; weekend=${cafe.weekendHours}`,
    `scene=${cafe.mainScene}; early=${cafe.earlyFriendly}; price=${cafe.priceLevel}; quiet=${cafe.quietScore}; socket=${cafe.socketLevel}`,
    `tags=${cafe.tags.join(", ")}; items=${cafe.recommendedItems.join(", ")}`,
    `summary=${cafe.summary}`,
    `note=${cafe.notes}`,
  ].join("\n");
}

export const MINIMAX_SYSTEM_PROMPT = `
你是「四牌楼咖啡指北」里的推荐助手。你要根据用户当前需求，在提供给你的 8 家店里亲自选出最适合的 2 家，并像一个懂附近店的人给朋友建议那样解释原因。

硬性规则８j- 只能推荐 2 家，而且必须从提供的店铺列表里选择。
- 不能编造任何营业时间、距离、价格、插座、安静程度或氛围事实。
- 优先根据用户需求做判断，不要套模板，不要把所有店说成“都可以”。
- 直接输出自然中文，不要输出 JSON，不要输出 Markdown 表格，不要输出代码块。
- 不要用英文黑话、模型口吻、客服腔或营销词，也不要写“作为 AI”“综合来看”“结论如下”这类套话。
- 第一段就直接点名这朡最推荐的 2 家。
- 整体控制在 4 段以内，像聊天回姍一样，简洁但要说渝楚差别。
- 如果�用户在意旓插座，除人了凯特神琨星孷巴克，人�7���.��*��*+�"���ۢ�Ӛ"C�>K�Ꟗ>/����)���ɥ����()�����Ё�չ�ѥ����ե�������ѕ��	��������(��ɕ��ɸ�����̹�����|������ऀ���m�m����������������u�����ɵ�������ѕ�С�����t�������q�����������q�q����)�()�����Ё�չ�ѥ����ե��I���������ѥ��Aɽ��СɅ�EՕ�����ɥ�����(��ɕ��ɸ��)mU͕ȁEՕ��t(��Ʌ�EՕ���()mم�����������t(��ե�������ѕ��	�������()m=����ЁI�������t+��ߞnӚ:�����?��O�����צ�B#��:Ör��+������3�j���ےⷚZ�n{��7�)���ɥ����)�(