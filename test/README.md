# Container Traffic Control Tests

Simple unit tests for rule evaluation logic without browser dependencies.

## Running Tests

```bash
# Run all tests
node test/rule-engine-test.js

# Or use the Makefile
make test

# Add your own tests by editing test/rule-engine-test.js
```

## Test Structure

The test framework includes:

1. **Pattern Matching Tests** - Test simple and regex patterns
2. **No Rules Scenarios** - Test behavior when no rules are configured
3. **Allow Rules** - Test open container behavior
4. **Allow Only Rules** - Test restricted container behavior
5. **Priority Rules** - Test high priority rule selection
6. **Rule Order** - Test first-rule-wins tiebreaking

## Adding Your Own Tests

```javascript
test('Your Test Name', () => {
    const rules = [
        createRule('ContainerName', 'allow', 'pattern.com')
    ];
    const containerMap = new Map([['ContainerName', 'container-id']]);

    const result = evaluateContainerForUrl('https://test.com', 'CurrentContainer', rules, containerMap);
    assertEqual(result, 'ExpectedContainer', 'Test description');
});
```

## Helper Functions

- `createRule(containerName, action, urlPattern, highPriority)` - Create test rules
- `createContainer(name, id)` - Create container objects
- `assertEqual(actual, expected, message)` - Assert equality
- `evaluateContainerForUrl(url, currentContainer, rules, containerMap)` - Test rule engine
- `matchesPattern(url, pattern)` - Test pattern matching

## Current Issue Being Tested

The "No Rules" tests specifically test the issue you encountered:
- When no rules exist, should stay in manually selected container
- Currently fails because it defaults to "No Container"