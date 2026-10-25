// A small Stella (XMILE) model with its diagram positions, shaped like a Stella Architect save.
// Population has a width and height, so its x, y is the top-left corner (center 125, 120).
// Deaths has no size, so its x, y is the center. Births comes from a cloud.
export const DRAWN_MODEL = `<?xml version="1.0" encoding="utf-8"?>
<xmile version="1.0" xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0" xmlns:isee="http://iseesystems.com/XMILE">
  <header><name>Drawn_population</name></header>
  <model>
    <variables>
      <stock name="Population">
        <eqn>100</eqn>
        <inflow>Births</inflow>
        <outflow>Deaths</outflow>
      </stock>
      <flow name="Births"><eqn>Population*Birth_Rate</eqn></flow>
      <flow name="Deaths"><eqn>Population/Lifetime</eqn></flow>
      <aux name="Birth Rate"><eqn>0.1</eqn></aux>
      <aux name="Lifetime"><eqn>10</eqn></aux>
    </variables>
    <views>
      <view type="stock_flow">
        <stock x="100" y="100" width="50" height="40" name="Population"/>
        <flow x="40" y="120" name="Births">
          <pts><pt x="-20" y="120"/><pt x="100" y="120"/></pts>
        </flow>
        <flow x="210" y="120" name="Deaths">
          <pts><pt x="150" y="120"/><pt x="270" y="120"/></pts>
        </flow>
        <aux x="40" y="200" name="Birth\\nRate"/>
        <alias uid="9" x="201" y="191" width="18" height="18"><of>Lifetime</of></alias>
        <aux x="300" y="40" name="Lifetime"/>
        <connector uid="1" angle="90"><from>Birth_Rate</from><to>Births</to></connector>
        <connector uid="2" angle="60"><from>Population</from><to>Births</to></connector>
        <connector uid="3"><from><alias uid="9"/></from><to>Deaths</to></connector>
        <loop_indicator text="R" uid="5" x="55" y="135" width="30" height="30">
          <isee:name>Growth
Loop</isee:name>
        </loop_indicator>
      </view>
    </views>
  </model>
</xmile>`;
