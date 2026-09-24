<script lang="ts">
  const platform = window.skaro.platform;
</script>

<main data-platform={platform}>
  <h1>Skaro</h1>
</main>

<style>
  main {
    display: grid;
    place-items: center;
    height: 100vh;
  }

  h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-muted);
  }
</style>
