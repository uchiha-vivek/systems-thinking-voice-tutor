// A small hand-built Stella (XMILE) model in the same shape Stella Architect saves.
export const TINY_SIR = `<?xml version="1.0" encoding="utf-8"?>
<xmile version="1.0" xmlns="http://docs.oasis-open.org/xmile/ns/XMILE/v1.0" xmlns:isee="http://iseesystems.com/XMILE">
  <header><name>Tiny_SIR_model</name></header>
  <sim_specs time_units="Days"><start>0</start><stop>50</stop><dt>0.25</dt></sim_specs>
  <model>
    <variables>
      <stock name="Susceptible\\nPopulation S">
        <doc>People who can still catch it.

People</doc>
        <eqn>Total_Population_N - Infected_Population_I</eqn>
        <outflow>Infection_Rate</outflow>
        <units>People</units>
      </stock>
      <stock name="Infected\\nPopulation I">
        <eqn>1</eqn>
        <inflow>Infection_Rate</inflow>
        <outflow>Recovery_Rate</outflow>
      </stock>
      <flow name="Infection Rate">
        <eqn>Contact_Rate*Susceptible_Population_S*Infected_Population_I/Total_Population_N</eqn>
      </flow>
      <flow name="Recovery Rate">
        <eqn>Infected_Population_I/Recovery_Time</eqn>
      </flow>
      <aux name="Contact Rate"><eqn>0.5</eqn></aux>
      <aux name="Total Population N"><eqn>1000</eqn></aux>
      <aux name="Recovery Time"><eqn>7</eqn></aux>
      <aux name="Crowding Effect">
        <eqn>Infected_Population_I</eqn>
        <gf><xscale min="0" max="1000"/><yscale min="0" max="1"/><ypts>1,0.8,0.4,0.1</ypts></gf>
      </aux>
    </variables>
    <views>
      <view type="stock_flow">
        <connector polarity="-" uid="1">
          <isee:reasoning>A longer recovery time means people recover more slowly.</isee:reasoning>
          <from>Recovery_Time</from>
          <to>Recovery_Rate</to>
        </connector>
        <stacked_container name="Graph 1">
          <graph type="time_series">
            <plot><entity name="Infected_Population_I"/></plot>
            <plot><entity name="Susceptible_Population_S"/></plot>
          </graph>
        </stacked_container>
        <text_box>Adapted from a classroom example</text_box>
      </view>
    </views>
  </model>
</xmile>`;
