// PLUGIN EFFECT: the "graphql-diagnostics" plugin validates gql`` tagged
// templates, showing errors for empty or whitespace-only query bodies.

declare function gql(strings: TemplateStringsArray, ...values: unknown[]): string;

// VALID: non-empty query — no diagnostic
const query = gql`
  query GetUser($id: ID!) {
    user(id: $id) {
      name
      email
    }
  }
`;

// PLUGIN EFFECT: "graphql-diagnostics" plugin shows an error here
// because the query body is empty
const emptyQuery = gql``;

// Also caught: whitespace-only body
const whitespaceQuery = gql`   `;

export { query, emptyQuery, whitespaceQuery };
